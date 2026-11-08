const currency = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" });
const numberFormat = new Intl.NumberFormat("es-PE");
const productsTable = document.querySelector("#products-table");
const salesTable = document.querySelector("#sales-table");
const productDialog = document.querySelector("#product-dialog");
const stockDialog = document.querySelector("#stock-dialog");
const saleDialog = document.querySelector("#sale-dialog");
const productForm = document.querySelector("#product-form");
const stockForm = document.querySelector("#stock-form");
const saleForm = document.querySelector("#sale-form");
let products = [];
let toastTimer;
let searchTimer;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    throw new Error("El servidor devolvió una respuesta no válida. Comprueba que FarmaPlus siga ejecutándose y recarga la página.");
  }
  if (!response.ok) {
    throw new Error((data && data.error) || `No se pudo completar la operación (error ${response.status}).`);
  }
  if (data === null) {
    throw new Error("El servidor respondió vacío. Comprueba que FarmaPlus siga ejecutándose y recarga la página.");
  }
  return data;
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function formatDate(value) {
  const date = new Date(`${value.replace(" ", "T")}`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function renderProducts() {
  const emptyState = document.querySelector("#empty-state");
  const noResults = products.length === 0 && document.querySelector("#search-input").value.trim();
  document.querySelector("#empty-title").textContent = noResults ? "No se encontraron productos" : "Aún no hay productos";
  document.querySelector("#empty-description").textContent = noResults
    ? "Prueba con otro nombre, código o categoría."
    : "Registra el primer producto para comenzar a gestionar el inventario.";
  document.querySelector("#empty-add-button").hidden = Boolean(noResults);
  emptyState.hidden = products.length > 0;
  productsTable.closest("table").hidden = products.length === 0;
  document.querySelector("#product-total").textContent = `${numberFormat.format(products.length)} ${products.length === 1 ? "producto" : "productos"}`;

  productsTable.innerHTML = products.map((product) => {
    const low = product.lowStock === 1;
    return `
      <tr>
        <td><div class="product-name"><span class="product-icon" aria-hidden="true">✚</span>${escapeHtml(product.name)}</div></td>
        <td class="sku-text">${escapeHtml(product.sku)}</td>
        <td>${escapeHtml(product.category)}</td>
        <td class="price-text">${currency.format(product.price)}</td>
        <td class="stock-count ${low ? "low" : ""}">${numberFormat.format(product.stock)} <span style="color:#9aa49f;font-weight:400">/ mín. ${numberFormat.format(product.minStock)}</span></td>
        <td><span class="status-pill ${low ? "low" : ""}"><span></span>${low ? "Reponer" : "Disponible"}</span></td>
        <td><div class="row-actions">
          <button class="icon-button" type="button" data-action="edit" data-id="${product.id}" title="Editar producto" aria-label="Editar ${escapeHtml(product.name)}">✎</button>
          <button class="icon-button" type="button" data-action="stock" data-id="${product.id}" title="Actualizar stock" aria-label="Actualizar stock de ${escapeHtml(product.name)}">↕</button>
          <button class="icon-button" type="button" data-action="sell" data-id="${product.id}" title="Registrar venta" aria-label="Vender ${escapeHtml(product.name)}">＋</button>
        </div></td>
      </tr>`;
  }).join("");
}

function renderSales(sales) {
  salesTable.innerHTML = sales.map((sale) => `
    <tr>
      <td class="sku-text">#${sale.id}</td>
      <td class="product-name">${escapeHtml(sale.productName)}</td>
      <td>${numberFormat.format(sale.quantity)}</td>
      <td>${escapeHtml(formatDate(sale.soldAt))}</td>
      <td class="sale-total">${currency.format(sale.total)}</td>
    </tr>`).join("");
  document.querySelector("#sales-empty").hidden = sales.length > 0;
  salesTable.closest("table").hidden = sales.length === 0;
}

async function refreshDashboard() {
  const data = await api("/api/dashboard");
  document.querySelector("#product-count").textContent = numberFormat.format(data.productCount);
  document.querySelector("#unit-count").textContent = numberFormat.format(data.unitCount);
  document.querySelector("#low-stock-count").textContent = numberFormat.format(data.lowStockCount);
  document.querySelector("#sales-today").textContent = currency.format(data.salesToday);
  const lowStockSummary = document.querySelector("#low-stock-summary");
  lowStockSummary.textContent = data.lowStockCount === 0
    ? "Todos los productos están por encima de su stock mínimo."
    : `${numberFormat.format(data.lowStockCount)} ${data.lowStockCount === 1 ? "producto necesita" : "productos necesitan"} revisión o reposición.`;
}

async function refreshProducts(search = "") {
  products = await api(`/api/products?search=${encodeURIComponent(search)}`);
  renderProducts();
}

async function refreshSales() {
  renderSales(await api("/api/sales?limit=8"));
}

async function refreshAll(search = document.querySelector("#search-input").value) {
  await Promise.all([refreshDashboard(), refreshProducts(search), refreshSales()]);
}

function resetProductForm() {
  productForm.reset();
  productForm.elements.stock.value = "0";
  productForm.elements.minStock.value = "5";
  productForm.dataset.productId = "";
  document.querySelector("#product-dialog-title").textContent = "Nuevo producto";
  document.querySelector("#initial-stock-field").hidden = false;
  productForm.elements.stock.required = true;
  document.querySelector("#product-error").textContent = "";
}

function openNewProduct() {
  resetProductForm();
  productDialog.showModal();
}

function openEditProduct(product) {
  resetProductForm();
  productForm.dataset.productId = product.id;
  productForm.elements.name.value = product.name;
  productForm.elements.sku.value = product.sku;
  productForm.elements.category.value = product.category;
  productForm.elements.price.value = product.price;
  productForm.elements.minStock.value = product.minStock;
  document.querySelector("#product-dialog-title").textContent = "Editar producto";
  document.querySelector("#initial-stock-field").hidden = true;
  productForm.elements.stock.required = false;
  productDialog.showModal();
}

function openStockDialog(product) {
  stockForm.reset();
  stockForm.elements.quantity.value = "";
  document.querySelector("#stock-product-label").textContent = `${product.name} · Stock actual: ${product.stock} unidad${product.stock === 1 ? "" : "es"}.`;
  document.querySelector("#stock-error").textContent = "";
  stockForm.dataset.productId = product.id;
  stockDialog.showModal();
}

function openSaleDialog(productId = "") {
  saleForm.reset();
  saleForm.elements.quantity.value = "1";
  document.querySelector("#sale-error").textContent = "";
  const select = document.querySelector("#sale-product");
  const availableProducts = products.filter((product) => product.stock > 0);
  select.innerHTML = availableProducts.length
    ? availableProducts.map((product) => `<option value="${product.id}" ${String(product.id) === String(productId) ? "selected" : ""}>${escapeHtml(product.name)} — ${numberFormat.format(product.stock)} disp.</option>`).join("")
    : '<option value="">No hay productos con stock</option>';
  document.querySelector("#sale-quantity").disabled = availableProducts.length === 0;
  saleForm.querySelector('[type="submit"]').disabled = availableProducts.length === 0;
  updateSaleAvailability();
  saleDialog.showModal();
}

function updateSaleAvailability() {
  const product = products.find((item) => String(item.id) === document.querySelector("#sale-product").value);
  const quantity = document.querySelector("#sale-quantity");
  quantity.max = product ? product.stock : "";
  document.querySelector("#sale-availability").textContent = product
    ? `${numberFormat.format(product.stock)} unidades disponibles · ${currency.format(product.price)} por unidad`
    : "";
}

function updateView() {
  const viewNames = {
    inicio: "Resumen",
    inventario: "Inventario",
    ventas: "Ventas",
  };
  const requestedView = window.location.hash.slice(1);
  const activeView = Object.hasOwn(viewNames, requestedView) ? requestedView : "inicio";

  document.querySelectorAll(".app-view").forEach((view) => {
    view.hidden = view.dataset.view !== activeView;
  });
  document.querySelectorAll(".nav-link").forEach((link) => {
    const active = link.hash === `#${activeView}`;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.querySelector("#breadcrumb-view").textContent = viewNames[activeView];
  window.scrollTo(0, 0);
}

document.querySelector("#add-product-button").addEventListener("click", openNewProduct);
document.querySelector("#empty-add-button").addEventListener("click", openNewProduct);
document.querySelector("#new-sale-button").addEventListener("click", () => openSaleDialog());
document.querySelector("#dashboard-new-sale-button").addEventListener("click", () => openSaleDialog());

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector(`#${button.dataset.close}`).close());
});

document.querySelector("#search-input").addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    refreshProducts(event.target.value).catch((error) => showToast(error.message));
  }, 180);
});

productsTable.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const product = products.find((item) => item.id === Number(button.dataset.id));
  if (!product) return;
  if (button.dataset.action === "edit") openEditProduct(product);
  if (button.dataset.action === "stock") openStockDialog(product);
  if (button.dataset.action === "sell") openSaleDialog(product.id);
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const productId = productForm.dataset.productId;
  const values = new FormData(productForm);
  const body = {
    name: values.get("name"),
    sku: values.get("sku"),
    category: values.get("category"),
    price: Number(values.get("price")),
    minStock: Number(values.get("minStock")),
  };
  if (!productId) body.stock = Number(values.get("stock"));
  const error = document.querySelector("#product-error");
  error.textContent = "";
  try {
    await api(productId ? `/api/products/${productId}` : "/api/products", {
      method: productId ? "PATCH" : "POST",
      body: JSON.stringify(body),
    });
    productDialog.close();
    await refreshAll();
    showToast(productId ? "Producto actualizado correctamente." : "Producto registrado correctamente.");
  } catch (reason) {
    error.textContent = reason.message;
  }
});

stockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(stockForm);
  const error = document.querySelector("#stock-error");
  error.textContent = "";
  try {
    await api(`/api/products/${stockForm.dataset.productId}/stock`, {
      method: "POST",
      body: JSON.stringify({
        direction: values.get("direction"),
        quantity: Number(values.get("quantity")),
        note: values.get("note"),
      }),
    });
    stockDialog.close();
    await refreshAll();
    showToast("Movimiento de inventario registrado.");
  } catch (reason) {
    error.textContent = reason.message;
  }
});

document.querySelector("#sale-product").addEventListener("change", updateSaleAvailability);

saleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(saleForm);
  const error = document.querySelector("#sale-error");
  error.textContent = "";
  try {
    const sale = await api("/api/sales", {
      method: "POST",
      body: JSON.stringify({
        productId: Number(values.get("productId")),
        quantity: Number(values.get("quantity")),
      }),
    });
    saleDialog.close();
    await refreshAll();
    showToast(`Venta #${sale.id} registrada: ${currency.format(sale.total)}.`);
  } catch (reason) {
    error.textContent = reason.message;
  }
});

window.addEventListener("hashchange", updateView);
updateView();

refreshAll().catch((error) => {
  showToast(`No se pudo cargar el sistema: ${error.message}`);
  console.error(error);
});
