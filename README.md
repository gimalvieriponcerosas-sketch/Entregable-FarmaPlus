# FarmaPlus

Aplicación web local para registrar productos, controlar existencias, avisar sobre stock bajo y registrar ventas.

## Requisitos

- Node.js 22.5 o superior (usa `node:sqlite`, incluido en Node).

## Iniciar

Desde la carpeta del proyecto, ejecuta:

```powershell
npm.cmd start
```

Abre <http://127.0.0.1:3000> en el navegador. La base de datos se crea automáticamente en `data\farmaplus.sqlite`; los datos permanecen en ese equipo.

## Funcionalidades

- Consultar un resumen con indicadores, alertas de reposición y acceso rápido a ventas.
- Administrar el catálogo y existencias desde una vista de inventario independiente.
- Registrar y editar productos, códigos, categorías, precios y stock mínimo.
- Registrar ingresos o salidas de inventario con motivo.
- Generar alertas visuales cuando las existencias estén en el mínimo o por debajo.
- Registrar ventas; el stock y el resumen de ventas del día se actualizan automáticamente.
- Consultar el historial de ventas y buscar productos por nombre, código o categoría.

La aplicación inicia sin información de ejemplo. Ingresa productos reales de la botica antes de usarla para operaciones reales. Esta primera versión está pensada para ejecutarse localmente en un solo equipo y no incluye cuentas de usuario, integración con proveedores ni conexión con sistemas externos.
