# Fase 3: contratos

Pedidos web convertidos en venta, almuerzos por la web y mejoras de operación. Los esquemas ya están en `packages/shared/src/schemas/public-web.ts` (sección "Cobro y cancelación") y `sales.ts` (`webOrderNumber`): son la fuente de verdad. Complementa [CONTRATOS.md](CONTRATOS.md).

## Decisiones del dueño

1. El pedido web se **cobra al entregarlo**: el cobro crea una venta de mostrador en la caja abierta de quien cobra.
2. El **domicilio** lo escribe la cajera al cobrar y es para el domiciliario: se guarda en el pedido (`deliveryFee`) y **no** entra a la venta ni a la caja.
3. **Cancelar** un pedido web lo hace la cajera, sin PIN, solo mientras no se haya cobrado.
4. **Porciones** de almuerzo: se descuentan al cobrar, no al pedir. Si al cobrar ya no hay, el cobro falla con el mensaje de siempre y la cajera ajusta con el cliente.

## Estados

`PENDING → CONFIRMED → DISPATCHED`, con `PATCH /status` (solo el siguiente). `DELIVERED` solo con el cobro, desde `CONFIRMED` o `DISPATCHED`. `CANCELED` desde cualquier estado antes de `DELIVERED`. Helpers: `nextWebOrderStatus`, `canCheckoutWebOrder`, `canCancelWebOrder`.

## Rutas nuevas (panel, con sesión)

| Ruta                                   | Permiso                          | Cuerpo                          | Respuesta                         |
| -------------------------------------- | -------------------------------- | ------------------------------- | --------------------------------- |
| `POST /api/v1/web-orders/:id/checkout` | `web-orders:manage` y `pos:sell` | `webOrderCheckoutRequestSchema` | `{ order: WebOrder, sale: Sale }` |
| `POST /api/v1/web-orders/:id/cancel`   | `web-orders:manage`              | `cancelWebOrderRequestSchema`   | `{ order: WebOrder }`             |

Cobro:

- Reutiliza la lógica del cobro de mostrador de `sales.service.ts`: caja abierta obligatoria, `expectedTotal`, pagos mixtos, descuento con PIN sobre el tope, cliente para la factura, idempotencia por `clientRequestId` (un reintento devuelve la misma venta y no cobra dos veces).
- Las líneas de la venta se construyen **con los precios guardados en el pedido** (lo que el cliente aceptó), no con los de hoy. Si el producto ya no existe o está archivado, el cobro falla con `409`.
- Almuerzos: la línea lleva la elección (`lunch`) y descuenta porciones del menú del día **de hoy** con `adjustPortions`; se valida que la elección siga disponible.
- La venta queda con `webOrderNumber` = número del pedido. El pedido guarda `saleId` y `deliveryFee`, pasa a `DELIVERED` y registra el cambio en `statusHistory` y en la auditoría (`WEB_ORDER_CHARGED`, y `WEB_ORDER_CANCELED` al cancelar).
- Venta y pedido se guardan en la **misma transacción**.
- Anular después la venta (flujo normal de `/ventas`) no reabre el pedido.

## Pedido web con almuerzo (`POST /api/v1/public/pedidos`)

- Cada línea acepta `lunch` (ver `createWebOrderRequestSchema`). Los productos de categorías de almuerzos se aceptan solo si están en el menú **publicado de hoy**, con las mismas reglas que el POS: con `withChoices` exige elección válida y disponible; sin `withChoices` (Caldo) la rechaza.
- En el pedido no se descuentan porciones. Si el producto tiene límite y ya no quedan (`soldOut`), se rechaza con `409`.
- El precio es el del producto en la BD, como el resto del catálogo.
- `GET /api/v1/public/menu-del-dia` no cambia; la web usa `items[].productId` y `withChoices`.

## Propiedad de archivos

| Frente                | Puede modificar                                                                                                                                                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integración           | `docs/web/**`, `packages/shared/**` (los esquemas ya fijados; los frentes reportan si necesitan otro cambio)                                                                                                                                                                                                                     |
| X · Backend           | `backend/src/modules/web-orders/**`, `backend/src/modules/sales/**` (solo para exponer y reutilizar la lógica del cobro, sin cambiar su comportamiento), `backend/src/modules/public-web/**` (si hace falta), `backend/src/routes.test.ts` (sus filas), `packages/shared/src/constants/audit-actions.ts` (las 2 acciones nuevas) |
| Y · Web pública       | `web/**` (almuerzo: selector en `/menu-del-dia`, carrito y checkout con líneas de almuerzo)                                                                                                                                                                                                                                      |
| Z · Panel             | `frontend/src/features/web-orders/**`, y lo mínimo en `frontend/src/features/pos/**` para reutilizar el diálogo de cobro sin cambiar su comportamiento                                                                                                                                                                           |
| W · Operación (Ola 2) | aviso de pedido nuevo (sonido, contador en el menú lateral, notificación del navegador), impresión del pedido como comanda y reportes web frente a local; lo reparte la integración al lanzar la Ola 2                                                                                                                           |

## Commits

Los de siempre (ver CONTRATOS.md), en ramas `feat/f3-backend`, `feat/f3-web`, `feat/f3-panel` y `feat/f3-operacion`, fusionadas en `feat/fase-3`.
