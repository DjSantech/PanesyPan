# Web pública: contratos

Contratos entre la web pública (`web/`, Next.js, panesypan.com) y la API (`backend/`, api.panesypan.com). Cualquier cambio a este documento se acuerda antes de implementarlo.

## Convenciones generales

- **Prefijo:** las rutas públicas cuelgan del router público que ya existe, `/api/v1/public` (sin sesión). Las rutas de este documento se escriben completas.
- **Nombres de campos:** `camelCase` en inglés, igual que el resto de la API (`packages/shared`).
- **Dinero:** enteros en pesos colombianos (COP), con impuestos incluidos, igual que en el POS.
- **Fechas:** ISO 8601 en UTC; el día de negocio es `AAAA-MM-DD` en hora de Colombia (`toBusinessDate()` de `@panesypan/shared`).
- **Esquemas:** cada respuesta y petición se define con Zod en `packages/shared/src/schemas/public-web.ts` y la web lo importa desde `@panesypan/shared`. Nada de tipos duplicados a mano.
- **Errores:** el formato de error de siempre, `{ "error": { "code": string, "message": string } }` (`apiErrorResponseSchema`).
- **Nunca se expone:** stock, costos, `sold`/porciones vendidas, `sortOrder`, impuestos, datos de usuarios, ni productos archivados, agotados de categorías inactivas o con `isVisibleOnline = false`.

## Caché

| Ruta                              | `Cache-Control`                                                    | Revalidación en la web |
| --------------------------------- | ------------------------------------------------------------------ | ---------------------- |
| `GET /api/v1/public/catalogo`     | `public, max-age=60, s-maxage=300, stale-while-revalidate=600`     | `revalidate: 300`      |
| `GET /api/v1/public/menu-del-dia` | `public, max-age=30, s-maxage=60, stale-while-revalidate=120`      | `revalidate: 60`       |
| `GET /api/v1/public/negocio`      | `public, max-age=300, s-maxage=3600, stale-while-revalidate=86400` | `revalidate: 3600`     |
| `POST /api/v1/public/pedidos`     | `no-store`                                                         | sin caché              |
| `GET /api/v1/public/images/:file` | ya existe (`immutable`, 1 año)                                     | —                      |

## (a) Rutas públicas de lectura

### `GET /api/v1/public/catalogo`

Categorías activas con al menos un producto visible. Productos activos con `isVisibleOnline = true`, de categorías activas y **que no sean de categorías de almuerzos** (esos van por el menú del día). Ordenados como en el POS (`sortOrder`, luego nombre); el orden se da, el campo no se expone.

```json
{
  "categories": [
    {
      "slug": "panaderia",
      "name": "Panadería",
      "products": [
        {
          "id": "66f1c2...",
          "slug": "pan-coco",
          "name": "Pan Coco",
          "description": "Pan suave con coco rallado.",
          "price": 800,
          "isAvailable": true,
          "imageUrl": "/api/v1/public/images/66f1c3....webp"
        }
      ]
    }
  ]
}
```

- `id`: id del producto (lo necesita el carrito para el pedido; no es sensible).
- `description`: `""` si no tiene.
- `isAvailable: false` = agotado hoy: se muestra, pero no se puede agregar al carrito.
- `imageUrl`: ruta relativa a la API o `null` si no tiene foto. La web le antepone `NEXT_PUBLIC_API_URL`.

### `GET /api/v1/public/menu-del-dia`

Menú del día de **hoy** (hora de Colombia). Si no existe o no está publicado, responde `200` con `menu: null`; nunca un error.

```json
{
  "date": "2026-09-25",
  "menu": {
    "soups": [{ "name": "Sancocho", "isAvailable": true }],
    "principles": [{ "name": "Fríjoles", "isAvailable": true }],
    "proteins": [{ "name": "Pollo asado", "isAvailable": false }],
    "juice": "Mora",
    "notes": "",
    "items": [
      {
        "productId": "66f1c2...",
        "name": "Almuerzo",
        "price": 14000,
        "withChoices": true,
        "soldOut": false
      }
    ]
  }
}
```

- `items`: los productos del menú (`offerings`) activos. `price` es `null` si el producto no tiene precio válido (la web muestra el ítem sin precio).
- `soldOut`: `true` si tiene límite de porciones y ya se vendieron todas (se calcula en el servidor; nunca se exponen `portions` ni `sold`).
- Los almuerzos **no** se piden desde la web en esta fase (se muestran; el pedido web es solo del catálogo). Ver sección (b).

### `GET /api/v1/public/negocio`

Datos del negocio configurables en **Ajustes** del sistema (`business_settings`). No se agrega ningún campo a la base de datos.

```json
{
  "name": "Panes & Pan",
  "address": "Dosquebradas, Risaralda",
  "phone": ""
}
```

- `name`: `BUSINESS_NAME` de `@panesypan/shared`.
- `address`, `phone`: los de Ajustes; `""` si no están.
- **Fuente de verdad en la web:** `web/src/config/negocio.ts`. Si un campo de `negocio.ts` está vacío (marcado `TODO(dueño)`), la web usa el de esta ruta; si ambos están vacíos, la web oculta ese dato (nunca inventa uno).

## (b) Pedido web

### Modelo `WebOrder` (colección `weborders`) — único cambio de esquema autorizado

```ts
interface WebOrderAttrs {
  number: number; // consecutivo propio de pedidos web (1, 2, 3…), único
  status: 'PENDING' | 'CONFIRMED' | 'DISPATCHED' | 'DELIVERED';
  source: 'WEB';
  customer: {
    name: string; // 2–60
    phone: string; // celular colombiano: 10 dígitos que empiezan por 3
    address: string; // 5–120
    neighborhood: string; // barrio de Dosquebradas (ver zona de domicilio)
    note: string; // 0–200
  };
  lines: {
    productId: ObjectId;
    name: string; // copia al momento del pedido
    unitPrice: number; // precio de la BD, nunca el del cliente
    quantity: number; // 1–50
    total: number;
  }[]; // 1–30 líneas
  subtotal: number; // suma de las líneas
  deliveryFee: number | null; // null = "a confirmar por WhatsApp"
  total: number; // subtotal + (deliveryFee ?? 0)
  statusHistory: {
    status: WebOrder['status'];
    at: Date;
    by: { id: ObjectId; name: string } | null;
  }[];
  clientRequestId: string; // UUID de la web: reintentos no duplican el pedido (índice único)
  createdAt: Date;
  updatedAt: Date;
}
```

Etiquetas: `PENDING` Pendiente · `CONFIRMED` Confirmado · `DISPATCHED` Despachado · `DELIVERED` Entregado. Transiciones solo hacia adelante: `PENDING → CONFIRMED → DISPATCHED → DELIVERED`.

### `POST /api/v1/public/pedidos`

Petición:

```json
{
  "clientRequestId": "3f0c1d8e-…",
  "customer": {
    "name": "Ana Gómez",
    "phone": "3001234567",
    "address": "Cra 16 # 40-20",
    "neighborhood": "Los Molinos",
    "note": "Tocar el timbre"
  },
  "confirmsDosquebradas": true,
  "lines": [{ "productId": "66f1c2...", "quantity": 2 }]
}
```

- Esquema estricto (`strictObject`): cualquier campo extra (p. ej. `price`) se rechaza con `400`.
- El servidor recalcula todo con los precios de la BD. Un producto no visible en la web, archivado, agotado o de una categoría inactiva o de almuerzos → `409 OUT_OF_STOCK` con el nombre del producto.
- Zona de domicilio: `DELIVERY_NEIGHBORHOODS` en `packages/shared/src/schemas/public-web.ts` (la misma lista para la web y la API), **vacía y marcada `// TODO(dueño)`**: los barrios los da el dueño, no se inventan.
  - Si la lista tiene barrios, `neighborhood` debe ser uno de ellos; si no → `400`: "Solo hacemos domicilios en Dosquebradas".
  - Mientras la lista esté vacía, `neighborhood` es texto libre (2–60) y la petición exige `"confirmsDosquebradas": true` (casilla "Mi dirección está en Dosquebradas"); sin ella → `400` con el mismo mensaje.
- `deliveryFee`: siempre `null` en esta fase (lo cobra el domiciliario y varía). La web muestra "Domicilio: a confirmar por WhatsApp".
- Rate limit propio por IP: 5 pedidos cada 10 minutos (además del general).
- Los logs no guardan nombre, teléfono ni dirección (solo número de pedido e IP ya anonimizada por el logger).
- Tras guardar: aviso en tiempo real al panel (Socket.IO, ver abajo).

Respuesta `201` (o `200` si el `clientRequestId` ya existía):

```json
{
  "order": {
    "number": 17,
    "status": "PENDING",
    "lines": [
      {
        "productId": "66f1c2...",
        "name": "Pan Coco",
        "unitPrice": 800,
        "quantity": 2,
        "total": 1600
      }
    ],
    "subtotal": 1600,
    "deliveryFee": null,
    "total": 1600,
    "createdAt": "2026-09-25T15:04:05.000Z"
  }
}
```

La respuesta no devuelve los datos del cliente. La web arma el mensaje de WhatsApp con lo que el cliente escribió y el número y los totales de esta respuesta, y abre `https://wa.me/<whatsapp de negocio.ts>?text=…`.

### Panel (con sesión) — rutas privadas

| Ruta                                  | Permiso             | Uso                                                   |
| ------------------------------------- | ------------------- | ----------------------------------------------------- |
| `GET /api/v1/web-orders?status=`      | `web-orders:read`   | lista del día y pendientes, más nuevos primero        |
| `PATCH /api/v1/web-orders/:id/status` | `web-orders:manage` | `{ "status": "CONFIRMED" }`, solo el siguiente estado |

Permisos nuevos en `packages/shared/src/constants/permissions.ts`: `web-orders:read` y `web-orders:manage` para `ADMIN` y `CASHIER`. El cambio de estado queda en la auditoría (`WEB_ORDER_STATUS_CHANGED`).

**Tiempo real:** evento Socket.IO `web-orders:changed` (sin datos) al crear o cambiar un pedido, emitido a una sala `web-orders` a la que se unen los usuarios con `web-orders:read`. El panel vuelve a pedir la lista al recibirlo y, además, consulta cada 30 s como respaldo.

Panel: nueva sección **Pedidos web** (`/pedidos-web`) en el menú lateral, con número, hora, cliente, teléfono (enlace `tel:` y WhatsApp), dirección y barrio, ítems, total, estado y botón para pasar al siguiente estado; filtro por estado.

## (c) Propiedad de archivos

Cada frente solo modifica sus rutas. Si necesita algo fuera, lo reporta y no lo toca.

| Frente                     | Fase | Puede modificar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Integración                | 0    | `docs/web/**`, `pnpm-workspace.yaml`, `package.json` raíz (solo scripts de `web`), `eslint.config.js`, `tsconfig.json` raíz (referencia a `web`)                                                                                                                                                                                                                                                                                                                                                                         |
| A · Diseño y web base      | 2A   | `web/**` salvo `web/src/lib/seo/**`, `web/src/app/sitemap.ts`, `web/src/app/robots.ts`, `web/src/app/**/opengraph-image.*`, `web/src/features/cart/**`, `web/src/app/pedido/**`                                                                                                                                                                                                                                                                                                                                          |
| B · API pública            | 2B   | `backend/src/modules/public-web/**` (nuevo), `backend/src/routes.ts` (solo montar el router), `packages/shared/src/schemas/public-web.ts` (secciones de lectura), `packages/shared/src/index.ts` (solo el export)                                                                                                                                                                                                                                                                                                        |
| C · SEO local              | 2C   | `web/src/lib/seo/**`, `web/src/app/sitemap.ts`, `web/src/app/robots.ts`, `web/src/app/**/opengraph-image.*`, y solo `metadata`/`generateMetadata` y el `<script type="application/ld+json">` en las páginas de `web/src/app/**`                                                                                                                                                                                                                                                                                          |
| D · Pedidos y domicilios   | 2D   | `web/src/features/cart/**`, `web/src/app/pedido/**`, botón "Agregar" en las tarjetas de producto de `web/`, `backend/src/modules/web-orders/**` (nuevo), `backend/src/modules/realtime/**` (sala y evento), `backend/src/routes.ts` (montar router), `packages/shared/src/schemas/public-web.ts` (sección de pedidos), `packages/shared/src/constants/permissions.ts`, `frontend/src/features/web-orders/**` (nuevo), `frontend/src/app/router.tsx` y `frontend/src/features/layout/nav-items.ts` (una entrada cada uno) |
| E · Despliegue y seguridad | 2E   | `web/vercel.json`, `web/next.config.*` (solo headers), `web/.env.example`, `backend/.env.example`, `render.yaml` (solo `CORS_ORIGINS`), `README.md` (sección de la web), `docs/web/**`                                                                                                                                                                                                                                                                                                                                   |

`web/src/config/negocio.ts` lo crea A; después solo lo cambia el dueño (y D agrega la lista de barrios si no se importa de `shared`).

## (d) Commits

Conventional Commits en español, máximo ~70 caracteres, sin trailers de coautoría:

- `feat(web): …` web pública · `feat(api): …` rutas públicas y pedidos en el backend · `feat(shared): …` esquemas · `feat(frontend): …` panel · `test(web|api): …` · `fix(…): …` · `docs(web): …`.
- Commits atómicos por frente, en su rama (`feat/web-2a-diseno`, `feat/web-2b-api`, `feat/web-2c-seo`, `feat/web-2d-pedidos`, `feat/web-2e-despliegue`), que se fusionan con merge normal en `feat/web-publica`. Nadie hace `push`.
- Antes de cada commit: `pnpm check` en lo que toque el frente.
