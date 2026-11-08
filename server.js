const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "farmaplus.sqlite");
const MAX_BODY_BYTES = 1024 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sku TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    price REAL NOT NULL CHECK (price >= 0),
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    min_stock INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price REAL NOT NULL CHECK (unit_price >= 0),
    total REAL NOT NULL CHECK (total >= 0),
    sold_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    movement_type TEXT NOT NULL CHECK (movement_type IN ('entry', 'sale', 'adjustment')),
    quantity INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("La solicitud es demasiado grande."), { status: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error("El formato de los datos no es válido."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function requiredText(value, label, maxLength = 100) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw Object.assign(new Error(`${label} es obligatorio y debe tener hasta ${maxLength} caracteres.`), {
      status: 400,
    });
  }
  return value.trim();
}

function nonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw Object.assign(new Error(`${label} debe ser un número mayor o igual a cero.`), { status: 400 });
  }
  return number;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw Object.assign(new Error(`${label} debe ser un entero mayor o igual a cero.`), { status: 400 });
  }
  return number;
}

function withTransaction(operation) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function productById(id) {
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!product) {
    throw Object.assign(new Error("No se encontró el producto solicitado."), { status: 404 });
  }
  return product;
}

function productForApi(id) {
  return db.prepare(`
    SELECT id, name, sku, category, price, stock, min_stock AS minStock,
           CASE WHEN stock <= min_stock THEN 1 ELSE 0 END AS lowStock
    FROM products
    WHERE id = ?
  `).get(id);
}

function listProducts(search = "") {
  const query = `%${search.trim()}%`;
  return db.prepare(`
    SELECT id, name, sku, category, price, stock, min_stock AS minStock,
           CASE WHEN stock <= min_stock THEN 1 ELSE 0 END AS lowStock
    FROM products
    WHERE name LIKE ? OR sku LIKE ? OR category LIKE ?
    ORDER BY name COLLATE NOCASE
  `).all(query, query, query);
}

async function handleApi(request, response, url) {
  const { pathname } = url;

  if (request.method === "GET" && pathname === "/api/dashboard") {
    const inventory = db.prepare(`
      SELECT COUNT(*) AS productCount,
             COALESCE(SUM(stock), 0) AS unitCount,
             COALESCE(SUM(CASE WHEN stock <= min_stock THEN 1 ELSE 0 END), 0) AS lowStockCount
      FROM products
    `).get();
    const sales = db.prepare(`
      SELECT COALESCE(SUM(total), 0) AS salesToday
      FROM sales
      WHERE date(sold_at) = date('now', 'localtime')
    `).get();
    sendJson(response, 200, { ...inventory, ...sales });
    return;
  }

  if (request.method === "GET" && pathname === "/api/products") {
    sendJson(response, 200, listProducts(url.searchParams.get("search") || ""));
    return;
  }

  if (request.method === "POST" && pathname === "/api/products") {
    const body = await readJson(request);
    const name = requiredText(body.name, "El nombre");
    const sku = requiredText(body.sku, "El código", 40);
    const category = requiredText(body.category, "La categoría", 60);
    const price = nonNegativeNumber(body.price, "El precio");
    const stock = nonNegativeInteger(body.stock, "El stock");
    const minStock = nonNegativeInteger(body.minStock, "El stock mínimo");
    const id = withTransaction(() => {
      const result = db.prepare(`
        INSERT INTO products (name, sku, category, price, stock, min_stock)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(name, sku, category, price, stock, minStock);
      if (stock > 0) {
        db.prepare(`
          INSERT INTO stock_movements (product_id, movement_type, quantity, note)
          VALUES (?, 'entry', ?, 'Stock inicial')
        `).run(Number(result.lastInsertRowid), stock);
      }
      return Number(result.lastInsertRowid);
    });
    sendJson(response, 201, productForApi(id));
    return;
  }

  const stockMatch = pathname.match(/^\/api\/products\/(\d+)\/stock$/);
  if (request.method === "POST" && stockMatch) {
    const id = Number(stockMatch[1]);
    const body = await readJson(request);
    const quantity = nonNegativeInteger(body.quantity, "La cantidad");
    if (quantity === 0) {
      throw Object.assign(new Error("La cantidad debe ser mayor que cero."), { status: 400 });
    }
    const direction = body.direction;
    if (direction !== "entry" && direction !== "exit") {
      throw Object.assign(new Error("Selecciona si el movimiento es un ingreso o una salida."), { status: 400 });
    }
    const note = requiredText(body.note, "El motivo", 120);
    const delta = direction === "entry" ? quantity : -quantity;
    withTransaction(() => {
      const product = productById(id);
      if (product.stock + delta < 0) {
        throw Object.assign(new Error("La salida supera las existencias disponibles."), { status: 409 });
      }
      db.prepare(`
        UPDATE products SET stock = stock + ?, updated_at = datetime('now', 'localtime') WHERE id = ?
      `).run(delta, id);
      db.prepare(`
        INSERT INTO stock_movements (product_id, movement_type, quantity, note)
        VALUES (?, ?, ?, ?)
      `).run(id, direction === "entry" ? "entry" : "adjustment", delta, note);
    });
    sendJson(response, 200, productForApi(id));
    return;
  }

  const productMatch = pathname.match(/^\/api\/products\/(\d+)$/);
  if (request.method === "PATCH" && productMatch) {
    const id = Number(productMatch[1]);
    const body = await readJson(request);
    const name = requiredText(body.name, "El nombre");
    const sku = requiredText(body.sku, "El código", 40);
    const category = requiredText(body.category, "La categoría", 60);
    const price = nonNegativeNumber(body.price, "El precio");
    const minStock = nonNegativeInteger(body.minStock, "El stock mínimo");
    productById(id);
    db.prepare(`
      UPDATE products
      SET name = ?, sku = ?, category = ?, price = ?, min_stock = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(name, sku, category, price, minStock, id);
    sendJson(response, 200, productForApi(id));
    return;
  }

  if (request.method === "GET" && pathname === "/api/sales") {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 10, 1), 100);
    const rows = db.prepare(`
      SELECT id, product_name AS productName, quantity, unit_price AS unitPrice,
             total, sold_at AS soldAt
      FROM sales
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);
    sendJson(response, 200, rows);
    return;
  }

  if (request.method === "POST" && pathname === "/api/sales") {
    const body = await readJson(request);
    const productId = nonNegativeInteger(body.productId, "El producto");
    const quantity = nonNegativeInteger(body.quantity, "La cantidad");
    if (productId === 0 || quantity === 0) {
      throw Object.assign(new Error("Selecciona un producto y una cantidad mayor que cero."), { status: 400 });
    }
    const sale = withTransaction(() => {
      const product = productById(productId);
      if (product.stock < quantity) {
        throw Object.assign(new Error(`Stock insuficiente. Disponible: ${product.stock}.`), { status: 409 });
      }
      const total = Math.round(product.price * quantity * 100) / 100;
      const result = db.prepare(`
        INSERT INTO sales (product_id, product_name, quantity, unit_price, total)
        VALUES (?, ?, ?, ?, ?)
      `).run(productId, product.name, quantity, product.price, total);
      db.prepare(`
        UPDATE products SET stock = stock - ?, updated_at = datetime('now', 'localtime') WHERE id = ?
      `).run(quantity, productId);
      db.prepare(`
        INSERT INTO stock_movements (product_id, movement_type, quantity, note)
        VALUES (?, 'sale', ?, ?)
      `).run(productId, -quantity, `Venta #${result.lastInsertRowid}`);
      return {
        id: Number(result.lastInsertRowid),
        productName: product.name,
        quantity,
        unitPrice: product.price,
        total,
      };
    });
    sendJson(response, 201, sale);
    return;
  }

  sendJson(response, 404, { error: "No se encontró la ruta solicitada." });
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }

  const requestedFile = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const allowedFiles = new Set(["index.html", "styles.css", "app.js"]);
  if (!allowedFiles.has(requestedFile)) {
    sendJson(response, 404, { error: "No se encontró el recurso solicitado." });
    return;
  }

  const filePath = path.join(__dirname, requestedFile);
  const content = await fs.promises.readFile(filePath);
  response.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filePath)],
    "Cache-Control": "no-cache",
  });
  response.end(content);
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    if (response.headersSent || response.destroyed) return;
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE" || error.errcode === 2067) {
      sendJson(response, 409, { error: "Ya existe un producto con ese código." });
      return;
    }
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error("Error en la solicitud:", error);
    sendJson(response, status, {
      error: status === 500 ? "Ocurrió un error interno. Revisa la consola del servidor." : error.message,
    });
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`El puerto ${PORT} ya está ocupado. FarmaPlus ya podría estar ejecutándose en http://${HOST}:${PORT}.`);
  } else {
    console.error("No se pudo iniciar el servidor de FarmaPlus:", error);
  }
  db.close();
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`FarmaPlus disponible en http://${HOST}:${PORT}`);
});

function closeServer() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", closeServer);
process.on("SIGTERM", closeServer);
