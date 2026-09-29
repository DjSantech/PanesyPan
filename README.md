# Panes & Pan · Sistema POS y plataforma web

Punto de venta, panel administrativo y (próximamente) web pública con domicilios para **Panes & Pan**, panadería en Dosquebradas, Risaralda (Colombia).

![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-24_LTS-5FA04E?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?logo=mongodb&logoColor=white)
![Licencia](https://img.shields.io/badge/licencia-privada-8B4513)

---

## Contenido

- [El negocio y el problema](#el-negocio-y-el-problema)
- [Funcionalidades por rol](#funcionalidades-por-rol)
- [Stack tecnológico](#stack-tecnológico)
- [Arquitectura](#arquitectura)
- [Estructura del monorepo](#estructura-del-monorepo)
- [Requisitos](#requisitos)
- [Instalación y ejecución local](#instalación-y-ejecución-local)
- [Variables de entorno](#variables-de-entorno)
- [Scripts disponibles](#scripts-disponibles)
- [Pruebas](#pruebas)
- [Uso del punto de venta](#uso-del-punto-de-venta)
- [Despliegue](#despliegue)
- [Operación y soporte](#operación-y-soporte)
- [Seguridad](#seguridad)
- [Roadmap](#roadmap)
- [Convención de commits](#convención-de-commits)
- [Licencia](#licencia)

---

## El negocio y el problema

Panes & Pan vende panadería y repostería (pan, pandebonos, buñuelos, tortas), bebidas (café, chocolate, jugos, gaseosas), almuerzos (menú del día y ejecutivo) y caldos en la mañana. Cuenta con **8 mesas** además de la venta en mostrador y para llevar.

El negocio necesita:

- **Vender rápido** en mostrador desde una pantalla táctil, con pagos en efectivo, Nequi, Daviplata, tarjeta o transferencia (incluso combinados).
- **Cuadrar la caja sin errores**: base inicial, egresos, retiros y arqueo al cierre con sobrantes y faltantes registrados.
- **Controlar el inventario** de productos terminados, la producción diaria de pan y las mermas.
- Que el administrador vea **ventas, estadísticas y flujo de caja en tiempo real** desde su celular.
- Más adelante, **recibir pedidos a domicilio** desde una web optimizada para búsquedas locales.

Todos los montos se manejan en pesos colombianos (COP) como **enteros**, con zona horaria `America/Bogota` y formato `es-CO` (`$ 12.500`).

## Funcionalidades por rol

| Rol                  | Puede                                                                                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Administrador**    | Todo: usuarios, productos, precios, categorías, impuestos, inventario, estadísticas y reportes, aprobar anulaciones, ver todas las cajas.                                                                                        |
| **Cajera**           | Abrir y cerrar su caja, registrar ventas y egresos menores con motivo, ver sus ventas del turno. No puede borrar ventas, cambiar precios ni ver estadísticas globales. Anular una venta requiere autorización del administrador. |
| **Cliente** (Fase 2) | Registrarse en la web, gestionar direcciones, hacer pedidos a domicilio y seguir su estado.                                                                                                                                      |

Los permisos se validan siempre en el backend; el frontend solo oculta lo que no corresponde. Las acciones sensibles quedan en un registro de auditoría.

## Stack tecnológico

| Capa                                  | Tecnología                                                                |
| ------------------------------------- | ------------------------------------------------------------------------- |
| Monorepo                              | pnpm workspaces                                                           |
| Lenguaje                              | TypeScript 6 (modo estricto) en todo el proyecto                          |
| POS y panel (`frontend`)              | React 19, Vite 8, Tailwind CSS 4, TanStack Query, Zustand, Recharts, PWA  |
| Web pública (Fase 2)                  | Next.js (App Router) con SSG/ISR                                          |
| API (`backend`)                       | Node.js 24, Express 5, Mongoose 9, Zod 4, Socket.IO, pino                 |
| Base de datos                         | MongoDB Atlas (replica set, transacciones)                                |
| Código compartido (`packages/shared`) | Esquemas Zod, tipos, constantes y utilidades de dinero y fechas           |
| Calidad                               | ESLint 10 (reglas con tipos), Prettier, Vitest 5, Supertest               |
| Infraestructura                       | Vercel (frontends), Render (API), Cloudflare (DNS, SSL, WAF), UptimeRobot |

## Arquitectura

```mermaid
flowchart LR
  subgraph Usuarios
    CAJ[Cajera<br/>tablet]
    ADM[Administrador<br/>celular]
    CLI[Cliente<br/>Fase 2]
  end

  subgraph Cloudflare[Cloudflare · DNS, SSL Full strict, WAF]
    DNS_POS[sistema.panesypan.com<br/>DNS only]
    DNS_WEB[panesypan.com<br/>DNS only]
    DNS_API[api.panesypan.com<br/>proxied]
  end

  subgraph Vercel
    POS[frontend<br/>SPA + PWA]
    WEB[web · Fase 2<br/>Next.js]
  end

  subgraph Render
    API[backend<br/>Express + Socket.IO]
  end

  DB[(MongoDB Atlas)]
  UR[UptimeRobot]

  CAJ & ADM --> DNS_POS --> POS
  CLI --> DNS_WEB --> WEB
  CAJ & ADM & CLI -- HTTPS / WSS --> DNS_API
  DNS_API -- header secreto X-Origin-Verify --> API
  API -- TLS, solo IPs de Render --> DB
  UR -- /api/health cada 5 min --> DNS_API
```

- Los frontends son estáticos o prerenderizados en Vercel. El navegador llama directamente a la API en `api.panesypan.com`.
- La API está detrás del proxy de Cloudflare. Cloudflare agrega un header secreto a cada petición y la API rechaza lo que no lo traiga, así nadie puede saltarse el WAF entrando por la URL `*.onrender.com`.
- La autenticación usa cookies `httpOnly` emitidas por `api.panesypan.com` (Fase 1A).
- La API está organizada por **módulos de dominio**. Cada módulo mantiene las capas `routes → controller → service → model`.

## Estructura del monorepo

```text
panesypan/
├─ backend/                   API REST (Express 5 + TypeScript)
│  ├─ src/
│  │  ├─ config/              Variables de entorno (Zod), logger, conexión a MongoDB
│  │  ├─ middlewares/         CORS, origen Cloudflare, rate limit, anti-inyección, errores
│  │  ├─ modules/             Un módulo por dominio (health, auth, sales, cash…)
│  │  ├─ lib/                 Errores y utilidades
│  │  ├─ app.ts               Crea la app de Express (sin abrir puertos, testeable)
│  │  └─ server.ts            Arranque, conexión a la BD y apagado ordenado
│  └─ test/                   Utilidades de pruebas (MongoDB en memoria)
├─ frontend/                  POS y panel administrativo (Vite + React)
│  ├─ public/                 Logo, íconos y robots.txt
│  ├─ src/features/           Una carpeta por funcionalidad
│  └─ vercel.json             Rewrites de SPA y headers de seguridad
├─ web/                       Web pública (Fase 2, aún no creada)
├─ packages/
│  └─ shared/                 Esquemas Zod, tipos, constantes, dinero y fechas
├─ e2e/                       Pruebas de punta a punta (Playwright + axe)
├─ scripts/                   MongoDB local, keep-alive, respaldo y restauración de la BD
├─ .github/workflows/ci.yml   Integración continua (revisiones, build y pruebas E2E)
├─ render.yaml                Blueprint de la API en Render
└─ package.json · pnpm-workspace.yaml · tsconfig.base.json · eslint.config.js
```

## Requisitos

- **Node.js 24 o superior** (producción usa Node 24 LTS).
- **pnpm 12**: `npm install -g pnpm`
- Git.

No hace falta instalar MongoDB ni Docker para desarrollar: el proyecto trae un MongoDB local (ver abajo).

## Instalación y ejecución local

```bash
# 1. Instalar dependencias (desde la raíz del repositorio)
pnpm install

# 2. Crear los archivos de entorno a partir de los ejemplos
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

**Base de datos local** (déjala en su propia terminal, desde la raíz):

```bash
pnpm dev:db
```

**API y POS**, cada uno en su propia terminal:

```bash
cd backend
npm run dev
```

```bash
cd frontend
npm run dev
```

`npm run dev` funciona en cada carpeta sin instalar nada aparte, porque `pnpm install` ya dejó las dependencias listas en `backend/node_modules` y `frontend/node_modules`. Para instalar o actualizar dependencias del proyecto se sigue usando `pnpm` desde la raíz (por el workspace); `npm run dev` es solo para arrancar cada app por separado.

Si prefieres un único comando desde la raíz que levante la API y el POS juntos: `pnpm dev`.

Luego abre:

| Qué                       | URL                                 |
| ------------------------- | ----------------------------------- |
| Sistema (login y panel)   | http://localhost:5173               |
| Salud de la API           | http://localhost:4000/api/health    |
| Salud de la base de datos | http://localhost:4000/api/health/db |

**Primer ingreso local:** la API crea el administrador inicial con las variables `SEED_ADMIN_*` de `backend/.env` (usuario `admin` en el ejemplo). En el primer ingreso pide cambiar la contraseña y crear el PIN de 6 números. Si prefieres crearlo sin levantar la API: `cd backend` y `npm run seed:admin`.

**Catálogo de prueba:** `cd backend` y `npm run seed:catalog` carga las categorías y los productos de la panadería con sus precios. Se puede ejecutar varias veces: solo crea lo que falta y nunca cambia precios que el administrador ya haya editado.

**¿Olvidaste una contraseña?** Las contraseñas se guardan cifradas y no se pueden recuperar. Genera una temporal con `cd backend` y `npm run reset:password -- <usuario>`: la cuenta queda desbloqueada, pide cambiar la contraseña y crear un PIN nuevo, y el cambio queda en la auditoría.

**Sobre la base de datos local (`pnpm dev:db`):**

- Levanta un replica set de un nodo en `127.0.0.1:27017`, que es lo que exigen las transacciones.
- Guarda los datos en `.local/mongo` y los conserva entre reinicios.
- La primera vez descarga el binario de MongoDB, lo que tarda uno o dos minutos.
- Detenla con `Ctrl+C`. Si cerraste la terminal y quedó corriendo en segundo plano, apágala con `pnpm dev:db:stop`.

## Variables de entorno

Los archivos `.env` **nunca** se suben al repositorio. Cada app tiene su `.env.example` con valores de ejemplo.

### API (`backend/.env`)

| Variable                | Descripción                                                                                                 | Ejemplo                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `NODE_ENV`              | `development`, `test` o `production`                                                                        | `development`                                           |
| `PORT`                  | Puerto HTTP (Render lo define solo)                                                                         | `4000`                                                  |
| `LOG_LEVEL`             | Nivel de logs de pino                                                                                       | `info`                                                  |
| `MONGODB_URI`           | Cadena de conexión a MongoDB                                                                                | `mongodb+srv://USUARIO:CLAVE@cluster.xxxxx.mongodb.net` |
| `MONGODB_DB_NAME`       | Nombre de la base de datos                                                                                  | `panesypan`                                             |
| `CORS_ORIGINS`          | Orígenes permitidos, separados por coma. En producción es obligatorio y todos deben usar https              | `https://sistema.panesypan.com`                         |
| `TRUST_PROXY_HOPS`      | Proxies de confianza (0 en local, 1 en Render)                                                              | `1`                                                     |
| `ORIGIN_VERIFY_SECRET`  | Secreto del header `X-Origin-Verify` que agrega Cloudflare. Obligatorio en producción, mínimo 32 caracteres | `(generado, ver abajo)`                                 |
| `RATE_LIMIT_WINDOW_MS`  | Ventana del límite general, en ms                                                                           | `60000`                                                 |
| `RATE_LIMIT_MAX`        | Peticiones por IP en esa ventana                                                                            | `600`                                                   |
| `AUTH_RATE_LIMIT_MAX`   | Intentos fallidos de login o PIN por IP cada 15 minutos                                                     | `30`                                                    |
| `JWT_ACCESS_SECRET`     | Secreto para firmar la sesión. Obligatorio, mínimo 32 caracteres, distinto de `CSRF_SECRET`                 | `(generado)`                                            |
| `CSRF_SECRET`           | Secreto para el token anti-CSRF. Obligatorio, mínimo 32 caracteres                                          | `(generado)`                                            |
| `SEED_ADMIN_USERNAME`   | Usuario del primer administrador (solo se usa si no existe ninguno)                                         | `admin`                                                 |
| `SEED_ADMIN_PASSWORD`   | Contraseña inicial del primer administrador; se cambia en el primer ingreso. Bórrala después                | `(una frase larga)`                                     |
| `SEED_ADMIN_NAME`       | Nombre visible del primer administrador (opcional)                                                          | `Administrador`                                         |
| `SEED_ADMIN_EMAIL`      | Correo del primer administrador (opcional)                                                                  | `duena@correo.com`                                      |
| `FACTUS_ENV`            | Ambiente de Factus: `sandbox` (habilitación) o `production`                                                 | `sandbox`                                               |
| `FACTUS_CLIENT_ID`      | Credencial de la API de Factus (opcional; sin las cuatro solo hay proveedor simulado)                       | `(panel de Factus)`                                     |
| `FACTUS_CLIENT_SECRET`  | Credencial de la API de Factus                                                                              | `(panel de Factus)`                                     |
| `FACTUS_USERNAME`       | Usuario (correo) de la cuenta de Factus                                                                     | `facturacion@panesypan.com`                             |
| `FACTUS_PASSWORD`       | Contraseña de la cuenta de Factus                                                                           | `(panel de Factus)`                                     |
| `CLOUDINARY_CLOUD_NAME` | Cuenta de Cloudinary donde se guardan las fotos de productos (opcional; sin las tres, van a MongoDB)        | `(panel de Cloudinary)`                                 |
| `CLOUDINARY_API_KEY`    | API Key de Cloudinary                                                                                       | `(panel de Cloudinary)`                                 |
| `CLOUDINARY_API_SECRET` | API Secret de Cloudinary (solo en el servidor)                                                              | `(panel de Cloudinary)`                                 |

Para generar un secreto seguro:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

La API valida todas sus variables al arrancar y se niega a iniciar si falta algo. Los mensajes de error indican qué variable falla, nunca su valor.

### POS (`frontend/.env`)

| Variable       | Descripción                                                                                                   | Ejemplo                     |
| -------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `VITE_API_URL` | URL base de la API, sin barra final. Es visible en el navegador: nunca pongas secretos en variables `VITE_*`. | `https://api.panesypan.com` |

## Scripts disponibles

Desde la raíz del repositorio:

| Script                              | Qué hace                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm dev`                          | API (http://localhost:4000) y POS (http://localhost:5173) en modo desarrollo |
| `pnpm dev:db`                       | MongoDB local de desarrollo                                                  |
| `pnpm dev:db:stop`                  | Apaga el MongoDB local si quedó en segundo plano                             |
| `pnpm build`                        | Compila la API (`backend/dist`) y el POS (`frontend/dist`)                   |
| `pnpm typecheck`                    | Verificación de tipos en todo el monorepo                                    |
| `pnpm lint` / `pnpm lint:fix`       | ESLint con reglas que usan la información de tipos                           |
| `pnpm format` / `pnpm format:check` | Prettier                                                                     |
| `pnpm test`                         | Todas las pruebas (Vitest + Supertest)                                       |
| `pnpm test:e2e`                     | Pruebas de punta a punta en un navegador real (ver "Pruebas")                |
| `pnpm check`                        | typecheck + lint + formato + pruebas (correr antes de cada commit)           |
| `pnpm db:keepalive`                 | Ping y escritura mínima a MongoDB (keep-alive de Atlas)                      |
| `pnpm db:backup`                    | Respaldo completo de la base de datos en `backups/` (ver "Respaldos")        |
| `pnpm db:restore -- <archivo> …`    | Restaura un respaldo (pide confirmar con el nombre de la base)               |

Scripts del backend (desde `backend/`):

| Script                                | Qué hace                                                       |
| ------------------------------------- | -------------------------------------------------------------- |
| `npm run seed:admin`                  | Crea el primer administrador con las variables `SEED_ADMIN_*`  |
| `npm run seed:catalog`                | Carga el catálogo inicial (categorías y productos con precios) |
| `npm run reset:password -- <usuario>` | Genera una contraseña temporal para un usuario que la olvidó   |

Cada paquete también tiene sus propios `dev`, `build`, `typecheck`, `lint` y `test`. Se pueden correr con `npm run <script>` dentro de la carpeta (`backend`, `frontend` o `packages/shared`), o desde la raíz con `pnpm --filter @panesypan/backend test`.

## Pruebas

| Tipo                    | Herramienta                             | Qué cubre                                                                                          |
| ----------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Unitarias e integración | Vitest + Supertest + MongoDB en memoria | Reglas de negocio, API completa, permisos y concurrencia (`pnpm test`)                             |
| Matriz de acceso        | `backend/src/routes.test.ts`            | Cada ruta de la API exige sesión y el permiso correcto; falla si se agrega una ruta sin declararla |
| Punta a punta           | Playwright (Chromium)                   | Un turno completo en el navegador: primer ingreso, cajera, mostrador, mesa, cierre y panel         |
| Accesibilidad           | axe-core dentro de las pruebas E2E      | WCAG 2.2 AA en tema claro y oscuro en cada pantalla del recorrido                                  |

**Pruebas de punta a punta.** La primera vez descarga el navegador (unos 150 MB, solo en tu equipo):

```bash
pnpm --filter @panesypan/e2e exec playwright install chromium
pnpm test:e2e
```

No necesitan `pnpm dev:db` ni `.env`: levantan su propia base de datos en memoria, la API en el puerto 4100 y el POS en el 5174, y los apagan al terminar. Si una prueba falla, el reporte queda en `e2e/test-results/` con captura de pantalla y traza (`npx playwright show-trace <archivo>`).

**Integración continua.** En cada push a `main` y en cada pull request, GitHub Actions corre `pnpm check`, el build de producción y las pruebas de punta a punta (`.github/workflows/ci.yml`). No usa secretos. Si algo falla, el reporte de Playwright queda como artefacto del workflow durante 7 días.

## Uso del punto de venta

**Rutas:** `/vender` (punto de venta), `/ventas` (ventas de la caja o del día) y `/configuracion` (ajustes, solo administrador). La cajera entra directo a `/vender`.

1. **Abrir caja.** Al entrar a vender por primera vez en el turno, la cajera escribe la base en efectivo. Cada cajera tiene como máximo una caja abierta y todas sus ventas quedan en ella. Al terminar el turno se cierra con el arqueo (ver "Caja: egresos, retiros y cierre").
2. **Mostrador.** Se tocan los productos (o se busca con la tecla `/` y `Enter` agrega el primer resultado) y se cobra. El pedido se conserva si la tablet recarga la página.
3. **Mesas.** En "Mesas" se toca una mesa libre para abrir su cuenta. Se pueden agregar, subir o bajar cantidades, cambiar la cuenta de mesa o cancelarla. Varias cajeras pueden atender la misma mesa. Quitar productos de una mesa queda en la auditoría.
4. **Almuerzos.** Solo se venden si están en el menú del día **publicado**. Al tocar **Almuerzo** se elige la proteína, el principio y la sopa (o "Sin sopa"); la elección queda en la cuenta, la comanda y el tiquete. El **Caldo** solo se vende directo con su propio precio. Se descuentan las porciones: nunca se vende más de lo preparado, aunque dos cajeras cobren la última porción al mismo tiempo.
5. **Cobro.** Efectivo con botones de billetes y cambio en grande, Nequi, Daviplata, tarjetas o transferencia (con referencia opcional), o **pago combinado**. La API recalcula el total con los precios vigentes: si un precio cambió mientras se cobraba, avisa en vez de cobrar mal. Cada cobro lleva un identificador único, de modo que un reintento por mala señal no cobra dos veces.
6. **Descuentos.** Por porcentaje o valor, siempre con motivo. Hasta el tope configurado (10 % por defecto) los da la cajera; por encima, un administrador digita su PIN en la tablet.
7. **Anulaciones.** Desde `/ventas`, con motivo y PIN de administrador. Solo mientras la caja de esa venta siga abierta. La venta anulada deja de contar en la caja y devuelve las porciones de almuerzo.
8. **PIN de autorización.** Cinco PIN equivocados seguidos cierran la sesión de la cajera, y cada intento fallido queda como alerta en la auditoría.

### Catálogo y menú del día

**Productos** (`/catalogo`, administrador). Cada producto tiene:

- Nombre, categoría y **precio final** (ya incluye impuestos).
- **Foto:** se elige desde el computador o el celular. El navegador la reduce a máximo 1200 px antes de subirla (queda de unos 100 KB). Las meseras la ven en las fichas de Vender y la web pública la va a usar en la Fase 2. Solo se aceptan JPG, PNG y WebP: el servidor revisa el tipo real del archivo.
- **Descripción** (hasta 300 caracteres): qué lleva, tamaño, sabor. También es para la web.
- **Mostrar en la web:** si sale o no en la página pública.
- **Favorito:** aparece en los accesos rápidos de Vender.
- **Controlar inventario:** descuenta unidades al vender. Al crear el producto se escriben las **unidades disponibles ahora**, que quedan como un ajuste en el libro de inventario.
- **Impuesto:** solo se usa con la facturación electrónica activa.

Las imágenes se guardan en la misma base de datos y se sirven en `/api/v1/public/images/<id>.webp` con caché de un año. Cada foto nueva tiene otro id, así nunca se ve una vieja. Cloudflare las guarda en caché por la extensión.

**Almuerzos y menú del día** (`/menu-del-dia`). Los almuerzos funcionan distinto al resto:

1. En el catálogo, dentro de la categoría de tipo **Almuerzos (menú del día)**, crea el producto **Almuerzo** con su precio (hay un solo precio) y, si se vende aparte, el producto **Caldo** con el suyo. **No** les actives "Controlar inventario": sus porciones se controlan en el menú.
2. Cada día, en **Menú del día**:
   - Arriba, **Hoy hay** resume lo que se le ofrece al cliente.
   - En **Sopas**, **Principios** y **Proteínas**, agrega las opciones del día. Cuando una se acabe, apaga su interruptor: deja de salir en Vender.
   - Jugo y notas son opcionales.
   - En **Qué se vende hoy**, activa el Almuerzo y el Caldo, con sus porciones (vacío = sin límite). El Almuerzo va como **Almuerzo (elige)**: al venderlo se pide proteína, principio y sopa. El Caldo va como **Venta directa**.
   - Activa **Publicar menú** y guarda.
3. Solo entonces los almuerzos aparecen en Vender, con las porciones que quedan. Si hay almuerzos en el catálogo pero el menú de hoy no está publicado, Vender muestra un aviso con el enlace para publicarlo.

La sopa que va con el almuerzo está incluida en su precio; solo se cobra el Caldo cuando se pide solo. Los menús guardados antes de este cambio (una sola sopa y un solo principio) se leen como listas de una opción.

Las bebidas y los caldos de la categoría General "Caldos" son productos normales: se venden todos los días sin menú.

### Caja: egresos, retiros y cierre

El botón **Caja** del punto de venta muestra el efectivo esperado (base + ventas en efectivo − egresos − retiros) y los movimientos del turno.

- **Egresos:** gastos menores pagados con la caja (hielo, gas…), siempre con motivo. Hasta el tope de **Ajustes** ($ 50.000 por defecto) los registra la cajera; por encima, un administrador digita su PIN.
- **Retiros:** efectivo que se saca para guardarlo. Siempre los autoriza un administrador (su PIN en la tablet, o él mismo si es su caja). Nunca se puede sacar más efectivo del que hay en el cajón.
- **Cierre con arqueo:** se cuentan billetes y monedas por denominación. El sistema calcula el sobrante o faltante; si no cuadra exacto, la nota es obligatoria. No se puede cerrar con mesas abiertas, y una caja cerrada no admite más ventas, egresos ni anulaciones.
- Egresos, retiros y cierres (con la diferencia) quedan en la auditoría.

### Inventario

**Ruta:** `/inventario`. Solo controla los productos con **"Controlar inventario"** activo en el catálogo (pan, pandebonos, buñuelos…); bebidas y almuerzos siguen sin descontar.

1. **Producción.** En la pestaña "Producción de hoy" se registra cuántas unidades salieron del horno; se suman al stock. Lo puede hacer la cajera.
2. **Mermas.** Unidades perdidas (vencido, dañado, quemado, devuelto u otro motivo). Nunca dejan el stock negativo. Lo puede hacer la cajera.
3. **Ventas.** Al cobrar (mostrador o mesa) se descuentan las unidades, y al anular la venta se devuelven. Si no alcanza el stock, el cobro se rechaza completo con el mensaje "Solo quedan N unidades de …". Un producto con inventario que nunca tuvo producción registrada no se puede vender: registra primero la producción del día.
4. **Alertas.** El administrador define un **stock mínimo** por producto; cuando el stock llega a ese valor o baja de él, se muestra un aviso en la página y el badge "Bajo stock". Con mínimo 0 no hay alerta.
5. **Ajustes.** El administrador corrige el stock con un conteo físico (la nota es obligatoria) y se guarda la diferencia.
6. **Trazabilidad.** Cada movimiento (producción, merma, ajuste, venta y anulación) queda en un libro de solo inserción con quién lo hizo, y producción, mermas, ajustes y cambios de mínimo quedan en la auditoría.

Las cantidades son unidades enteras (máximo 10.000 por movimiento).

### Dashboard y reportes (administrador)

**Ruta:** `/` (inicio del administrador). La cajera no lo ve: entra directo a `/vender`.

- **Resumen de hoy:** ventas del día (total, cantidad y tiquete promedio), ventas por hora, medios de pago, lo más vendido, cajas abiertas con su efectivo esperado, egresos y retiros, cierres con diferencia, ventas anuladas y descuentos.
- **Alertas de inventario:** productos en o por debajo de su stock mínimo, más lo producido y las mermas del día.
- **Tiempo real:** cuando alguien cobra, anula, mueve la caja o registra inventario, el servidor avisa por Socket.IO y el panel se refresca solo. El aviso no lleva datos: el panel vuelve a pedirlos a la API, que valida el permiso. El indicador "En vivo" pasa a "Sin conexión en vivo" si el socket se cae; entonces el panel consulta cada 30 segundos y se reconecta solo.
- **Exportes CSV:** ventas, cajas con arqueo e inventario, por rango de fechas (máximo 92 días). Usan `;` como separador y UTF-8 con BOM, así que abren directo en Excel con las tildes bien. Los textos que empiezan como fórmula se neutralizan y cada descarga queda en la auditoría.
- El "día" es el día de negocio en hora de Colombia, igual que en las cajas.

### Instalar como app (PWA)

En producción el sistema se puede instalar en la tablet o el celular desde el navegador ("Instalar app" / "Agregar a pantalla de inicio"). Se abre a pantalla completa con el logo de la panadería.

- Solo se guardan los archivos de la app (pantallas, estilos, fuentes, íconos) para que abra rápido. **No se guarda ningún dato de la API**: ventas, cajas y sesiones siempre se consultan en vivo, y sin internet no se puede vender.
- Cuando hay una versión nueva aparece un aviso "Hay una versión nueva del sistema". La app no se recarga sola para no interrumpir una venta: se actualiza al tocar **Actualizar**.
- El service worker solo se activa en producción (`pnpm build`); en desarrollo no interviene.

### Impresora térmica

El tiquete se imprime con el diálogo de impresión del navegador:

1. Instala el driver de la impresora (58 u 80 mm) en el equipo o la tablet.
2. En **Ajustes** elige el ancho del papel y completa los datos del tiquete (razón social, NIT, dirección, teléfono y mensaje final). Hay una vista previa.
3. Al imprimir por primera vez elige la impresora térmica, márgenes **Ninguno** y desactiva "Encabezados y pies de página". El navegador recuerda la elección.

El tiquete dice "Precios con impuestos incluidos". Sin facturación electrónica activa, el tiquete **no** es una factura electrónica. Con ella activa, el tiquete incluye la representación impresa de la factura (ver abajo).

### Facturación electrónica (DIAN)

> **Estado: implementada y sin activar.** El código está listo y probado con el proveedor simulado, pero la facturación viene **apagada** y el sistema funciona igual que antes (tiquete sin validez de factura). Se activará cuando el contador confirme el régimen y las tarifas, y cuando estén la cuenta de Factus y la resolución de numeración de la DIAN (ver "Pasos para facturar de verdad").

**Rutas:** `/configuracion` (sección "Facturación electrónica") y `/facturacion` (documentos y reenvíos). Ambas son solo del administrador.

**Cómo funciona**

1. **Cada venta cobrada genera su factura electrónica de venta**, en mostrador o en mesa. Se factura a "Consumidor final" o, si el cliente la pide, a su nombre: en el cobro se toca **Factura a nombre del cliente** y se escriben el documento (el dígito de verificación del NIT se calcula solo), el nombre y, si quiere recibirla, el correo.
2. **La venta nunca se frena por la DIAN.** La factura queda en cola en la misma operación que la venta, así que si la venta se guardó, su factura también. Un proceso de la API la envía al proveedor en segundos.
3. **El tiquete sale con la factura.** Al cobrar, el sistema espera unos segundos la validación y el tiquete impreso trae el número, el CUFE, el código QR de consulta en la DIAN y el texto legal de Ajustes. Si la DIAN tarda, el tiquete lo dice y se puede reimprimir desde `/ventas` cuando quede validada.
4. **Si el proveedor o la red fallan**, la factura se reintenta sola durante unas horas (30 s, 1, 2, 5, 10 y 30 minutos, 1 hora). Si no sale, queda **Sin enviar** y el administrador la reenvía desde `/facturacion`.
5. **Si la DIAN la rechaza** (rango vencido, dato inválido, cuenta sin saldo…), queda **Rechazada** con el motivo. Corrige la causa en Ajustes o en el catálogo y toca **Reenviar**: se vuelve a armar con la configuración corregida.
6. **Anular una venta facturada genera la nota crédito** que la anula ante la DIAN. Si la factura nunca se intentó enviar, simplemente ya no se envía. Si hubo algún intento, la nota crédito espera a que la factura se valide y luego la anula, porque una falla de red puede ocultar que la factura sí llegó.
7. Una misma venta nunca se factura dos veces. Cada documento lleva un código de referencia único ante el proveedor y, si una respuesta se pierde, se recupera el documento ya emitido.

**Impuestos.** Los precios siguen incluyendo impuestos. Para la factura se separan base e impuesto según el impuesto de cada producto (catálogo → editar producto) o, si no tiene, el **impuesto general** de Ajustes: IVA 19 %, IVA 5 %, IVA 0 %, impuesto al consumo 8 % o sin impuesto. **Qué tarifa corresponde a cada producto lo define el contador**, según el régimen del negocio. La facturación no se puede activar sin definir el impuesto general.

**Proveedores**

| Proveedor | Para qué                                                                                                 | Validez tributaria                            |
| --------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Simulado  | Conocer el flujo y capacitar al equipo. Responde como si la DIAN validara, sin enviar nada.              | Ninguna: el tiquete dice "DOCUMENTO SIMULADO" |
| Factus    | Proveedor tecnológico autorizado por la DIAN, con API y ambiente de pruebas (https://www.factus.com.co). | Sí, en ambiente de producción                 |

El sistema usa un adaptador por proveedor (`backend/src/modules/einvoice/providers`). Si el negocio prefiere otro proveedor, se agrega su adaptador sin tocar ventas ni tiquetes.

**Pasos para facturar de verdad**

1. **Con el contador:** confirmar el régimen tributario, la tarifa de cada producto y si el negocio emite factura electrónica de venta para todas sus operaciones. La DIAN lo permite como alternativa al documento equivalente POS electrónico, y este sistema usa esa opción.
2. **En la DIAN (portal de facturación electrónica):**
   - Registrarse como facturador electrónico.
   - Elegir la modalidad "a través de proveedor tecnológico" con Factus.
   - Solicitar la **resolución de numeración** para facturas (y la de notas crédito, si el proveedor la pide aparte).
3. **En Factus:**
   - Crear la cuenta y asociar la resolución: Factus entrega el **ID del rango de numeración** de facturas y el de notas crédito.
   - Copiar las credenciales de la API (client id, client secret, usuario y contraseña).
4. **En Render:** cargar `FACTUS_CLIENT_ID`, `FACTUS_CLIENT_SECRET`, `FACTUS_USERNAME` y `FACTUS_PASSWORD` con `FACTUS_ENV=sandbox`, y redesplegar.
5. **En Ajustes → Facturación electrónica:**
   - Proveedor **Factus**, los dos rangos de numeración y el impuesto general.
   - En "Texto legal de la factura impresa", la resolución (número, fecha, prefijo, rango y vigencia) y el proveedor tecnológico.
   - Activar **Facturar electrónicamente cada venta**.
6. **Habilitación:** hacer las ventas de prueba que exige la DIAN (el set de pruebas) en el ambiente de pruebas. Revisar en `/facturacion` que queden **Validadas** y que el tiquete muestre el CUFE y el QR. Probar también una anulación con nota crédito y una factura a nombre de un cliente con NIT.
7. **Paso a producción:** cuando la DIAN habilite el software, cambiar `FACTUS_ENV=production` en Render. Si Factus entrega rangos distintos para producción, actualizarlos en Ajustes.

> El adaptador de Factus sigue su documentación pública (API v2). Los detalles que solo se confirman con una cuenta real (formato exacto de las respuestas, redondeos de centavos, códigos de consumidor final) se validan en el paso 6, antes de facturar en producción.

**Credenciales.** Las de Factus viven solo en las variables de entorno del servidor: nunca se guardan en la base de datos, no se muestran en pantalla y no se escriben en los logs. Sin ellas, el sistema solo ofrece el proveedor simulado.

**Exporte para el contador.** El CSV de ventas incluye el número de la factura electrónica, su estado, el CUFE, la nota crédito y el cliente.

## Despliegue

| Pieza                | Servicio                        | Dominio                 |
| -------------------- | ------------------------------- | ----------------------- |
| POS y panel          | Vercel                          | `sistema.panesypan.com` |
| Web pública (Fase 2) | Vercel                          | `panesypan.com`         |
| API                  | Render (Web Service, plan free) | `api.panesypan.com`     |
| Base de datos        | MongoDB Atlas                   | —                       |

### 1. MongoDB Atlas

1. Crea un proyecto y un cluster en **AWS / N. Virginia (us-east-1)**, la misma región que la API en Render.
2. En **Database Access**, crea un usuario solo con `readWrite` sobre la base `panesypan`. No le des permisos de administrador.
3. En **Network Access**, agrega **solo las IPs de salida de Render**. Las encuentras en Render → tu servicio → _Connect_ → _Outbound_. No uses `0.0.0.0/0`.
4. Copia la cadena `mongodb+srv://…`: será `MONGODB_URI` en Render.
5. Si necesitas correr un script contra producción desde tu PC (por ejemplo, crear el primer administrador en la Fase 1A), agrega tu IP temporalmente y quítala al terminar.

### 2. Render (API)

1. En Render: **New → Blueprint** y elige este repositorio. Render lee `render.yaml`.
2. Ingresa los valores que el blueprint marca como `sync: false`: `MONGODB_URI`, `ORIGIN_VERIFY_SECRET` y las variables `SEED_ADMIN_*` del primer administrador. `JWT_ACCESS_SECRET` y `CSRF_SECRET` los genera Render solo.
   - Después de tu primer ingreso (en el que cambias la contraseña), **borra `SEED_ADMIN_PASSWORD`** en Render.
3. En **Settings → Custom Domains**, agrega `api.panesypan.com`.
4. Comandos configurados en `render.yaml`:
   - Build: `NODE_ENV=development npx --yes pnpm@12.5.1 install --frozen-lockfile && npx --yes pnpm@12.5.1 --filter @panesypan/backend build`
   - Start: `node backend/dist/server.js`
   - Health check: `/api/health`
5. Plan free:
   - El servicio se duerme tras 15 minutos sin tráfico; UptimeRobot lo mantiene despierto (ver abajo).
   - Hay 750 horas gratis al mes, suficientes para un solo servicio encendido todo el mes.

### 3. Vercel (POS)

1. **Add New → Project** e importa el repositorio.
2. En **Root Directory**, pon `frontend`. Vercel detecta pnpm y el workspace; deja activa la opción de incluir archivos fuera del root directory, porque el POS usa `packages/shared`.
3. Build y rewrites quedan definidos en `frontend/vercel.json`.
4. En **Settings → Environment Variables** (Production), agrega `VITE_API_URL=https://api.panesypan.com`.
5. En **Settings → Node.js Version**, elige `24.x`.
6. En **Settings → Domains**, agrega `sistema.panesypan.com`.

### 4. Cloudflare

**DNS**

| Tipo      | Nombre       | Destino                                               | Proxy                      |
| --------- | ------------ | ----------------------------------------------------- | -------------------------- |
| CNAME     | `sistema`    | el que indique Vercel (p. ej. `cname.vercel-dns.com`) | **DNS only** (nube gris)   |
| CNAME     | `api`        | `<tu-servicio>.onrender.com`                          | **Proxied** (nube naranja) |
| A / CNAME | `@` (Fase 2) | el que indique Vercel                                 | **DNS only**               |

**SSL/TLS**

- Modo **Full (strict)**.
- Activa _Always Use HTTPS_ y usa como versión mínima TLS 1.2.

**Header secreto de origen (obligatorio)**

Ve a _Rules → Transform Rules → Modify Request Header → Create rule_:

- Condición: `Hostname` igual a `api.panesypan.com`.
- Acción: **Set static**, header `X-Origin-Verify`, valor igual a `ORIGIN_VERIFY_SECRET` de Render.

Sin esta regla, la API en producción responde `403` a todo, excepto a `/api/health*`.

**WebSockets (dashboard en tiempo real)**

- En _Network_, confirma que **WebSockets** esté activado (lo está por defecto, también en el plan gratis). El dashboard usa `wss://api.panesypan.com/api/realtime`.
- La regla del header `X-Origin-Verify` también protege el socket: Cloudflare la aplica a la petición de conexión.
- Si el socket no conecta, el dashboard sigue funcionando: consulta la API cada 30 segundos.

**WAF: permitir a UptimeRobot**

Ve a _Security → WAF → Custom rules → Create rule_:

- Expresión:
  ```text
  (http.host eq "api.panesypan.com" and starts_with(http.request.uri.path, "/api/health") and http.user_agent contains "UptimeRobot")
  ```
- Acción: **Skip**. Marca las reglas personalizadas restantes, el rate limiting y las reglas administradas.
- _Bot Fight Mode_ (plan gratis) no se puede exceptuar con reglas y puede bloquear a UptimeRobot. Déjalo desactivado.
- Los endpoints de salud no exponen información sensible: solo estado, tiempo activo y versión.

### 5. UptimeRobot: mantener el servicio despierto

| Monitor       | URL                                       | Intervalo | Propósito                                                 |
| ------------- | ----------------------------------------- | --------- | --------------------------------------------------------- |
| API           | `https://api.panesypan.com/api/health`    | 5 min     | Evita que Render duerma el servicio; no toca la BD.       |
| Base de datos | `https://api.panesypan.com/api/health/db` | 30–60 min | Hace un `ping` real a MongoDB y alerta si responde `503`. |

Configura un contacto de alerta (correo o Telegram) para ambos monitores.

### 6. Keep-alive de la base de datos

Atlas pausa automáticamente los clusters gratuitos que pasan mucho tiempo sin actividad. Con esta arquitectura:

1. **Mecanismo principal:** la API mantiene una conexión permanente con Atlas, y el monitor de `/api/health/db` ejecuta un `ping` real cada 30–60 minutos.
2. **Respaldo:** `pnpm db:keepalive` (archivo `scripts/db-keepalive.ts`) se conecta, hace `ping` y una escritura mínima en la colección `keepalive`, y se desconecta.
   - Lee `MONGODB_URI` y `MONGODB_DB_NAME` del entorno.
   - Si no existen, las toma de `backend/.env`.
   - Sale con código `1` si falla, para que el cron pueda alertar.

Como Atlas solo acepta las IPs de Render, el script debe correr desde un origen permitido:

- Tu PC, con la IP agregada temporalmente en Atlas.
- Un **Render Cron Job** (servicio de pago), que sale por las mismas IPs de la región.
- **GitHub Actions**, que usa IPs variables y obligaría a abrir Atlas a `0.0.0.0/0`. **No se recomienda.** Si en algún momento se decide usarlo, este es el workflow (con el secreto `MONGODB_URI` en el repositorio):

```yaml
# .github/workflows/db-keepalive.yml
name: db-keepalive
on:
  schedule:
    - cron: '0 */12 * * *'
  workflow_dispatch:
jobs:
  keepalive:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:keepalive
        env:
          MONGODB_URI: ${{ secrets.MONGODB_URI }}
          MONGODB_DB_NAME: panesypan
```

### 7. Respaldos

El plan gratis de Atlas (M0) **no hace copias automáticas**. Los respaldos se hacen con `pnpm db:backup`:

```bash
pnpm db:backup                   # guarda en backups/ y conserva los 10 más recientes
pnpm db:backup -- --keep 20      # conserva otra cantidad
pnpm db:backup -- --out D:/respaldos
```

- Genera un archivo `panesypan-AAAA-MM-DD-HHMM.ndjson.gz` con todas las colecciones y sus índices, leídas en un mismo instante: el respaldo es consistente aunque se esté vendiendo.
- Conserva los tipos de MongoDB (fechas, identificadores, enteros), así que restaurar deja la base exactamente igual.
- La carpeta `backups/` está en `.gitignore`. Copia los respaldos a otro lugar (una memoria USB o la nube personal del negocio): contienen datos del negocio y hashes de contraseñas.
- **Frecuencia recomendada:** una vez por semana y antes de cualquier cambio grande (subir de versión, cargar catálogo, etc.).

**Cómo correrlo contra producción.** Atlas solo acepta las IPs de Render, así que:

1. En Atlas → _Network Access_ → _Add IP Address_ → **Add current IP address**, y marca _This entry is temporary_ (6 horas).
2. Pon la cadena de producción solo en la terminal, nunca en un archivo del repositorio:
   ```bash
   # Git Bash
   MONGODB_URI="mongodb+srv://…" MONGODB_DB_NAME=panesypan pnpm db:backup
   ```
   ```powershell
   # PowerShell
   $env:MONGODB_URI = "mongodb+srv://…"; $env:MONGODB_DB_NAME = "panesypan"; pnpm db:backup
   ```
3. Cierra la terminal al terminar. La entrada temporal de Atlas se borra sola.

**Restaurar.** Detén la API primero (Render → _Suspend_) para que nadie venda mientras tanto:

```bash
pnpm db:restore -- backups/panesypan-2026-09-24-2130.ndjson.gz --confirm panesypan
pnpm db:restore -- <archivo> --confirm panesypan --replace   # si la base ya tiene datos
```

- `--confirm` debe llevar el nombre exacto de la base de destino: evita restaurar sobre la base equivocada.
- Sin `--replace`, se detiene si alguna colección ya tiene datos. Con `--replace` las borra antes de restaurar.
- Al final compara la cantidad de documentos con la del respaldo y avisa si falta alguno.
- Para practicar sin riesgo, restaura sobre la base local (`pnpm dev:db` y `MONGODB_DB_NAME=panesypan_prueba`).

### 8. Lista de verificación para salir a producción

**Antes del primer día**

- [ ] Atlas: cluster en us-east-1, usuario solo `readWrite`, Network Access solo con las IPs de Render.
- [ ] Render: blueprint aplicado, `MONGODB_URI`, `ORIGIN_VERIFY_SECRET` y `SEED_ADMIN_*` cargados; dominio `api.panesypan.com`.
- [ ] Vercel: root `frontend`, `VITE_API_URL=https://api.panesypan.com`, Node 24, dominio `sistema.panesypan.com`.
- [ ] Cloudflare: DNS (api con proxy, sistema sin proxy), SSL Full (strict), regla del header `X-Origin-Verify`, excepción del WAF para UptimeRobot.
- [ ] `https://api.panesypan.com/api/health/db` responde `200`, y `https://<servicio>.onrender.com/api/v1/auth/me` responde `403` (nadie se salta Cloudflare).
- [ ] UptimeRobot: los dos monitores activos y con contacto de alerta.
- [ ] Primer ingreso del administrador: cambia la contraseña, crea el PIN y **borra `SEED_ADMIN_PASSWORD` en Render**.
- [ ] Ajustes: razón social, NIT, dirección, teléfono, ancho del tiquete, número de mesas, topes de descuento y egresos.
- [ ] Catálogo cargado y revisado (precios, categorías, productos con inventario).
- [ ] Una cuenta por cajera (nunca compartidas); cada una ingresa, cambia su contraseña y crea su PIN.
- [ ] Tablet: app instalada (PWA) e impresora térmica probada con un tiquete, márgenes en "Ninguno".
- [ ] Prueba completa en producción: abrir caja, venta de mostrador, venta en mesa, anulación con PIN y cierre con arqueo. Después anula las ventas de prueba o explica el cierre con una nota.
- [ ] Primer respaldo con `pnpm db:backup`, guardado fuera del computador.
- [ ] Facturación electrónica: por ahora queda apagada. Cuando se decida activarla, seguir "Pasos para facturar de verdad".

**Cada semana**

- [ ] `pnpm db:backup` y copia del archivo fuera del computador.
- [ ] Revisar en Auditoría los PIN fallidos, bloqueos y anulaciones.
- [ ] Revisar las cajas con diferencia en el arqueo.

## Web pública

La web de clientes (`web/`, Next.js) se publica en `panesypan.com`. Ver los
[contratos de la API pública](docs/web/CONTRATOS.md) y el
[checklist de despliegue](docs/web/DESPLIEGUE.md).

## Operación y soporte

| Situación                                  | Qué hacer                                                                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Una cajera olvidó su contraseña            | Administrador → Usuarios → acciones de la persona → restablecer contraseña. Entrega la temporal; al ingresar la cambia y crea un PIN nuevo.                                                                   |
| Una cuenta quedó bloqueada (5 intentos)    | Se desbloquea sola en 15 minutos, o Usuarios → acciones → desbloquear.                                                                                                                                        |
| El administrador olvidó su contraseña      | Si hay otro administrador, él la restablece. Si no: `cd backend` y `npm run reset:password -- <usuario>` con la `MONGODB_URI` de producción en la terminal (IP temporal en Atlas, ver "Respaldos").           |
| Una cajera olvidó su PIN                   | Usuarios → acciones → restablecer PIN: al volver a ingresar crea uno nuevo.                                                                                                                                   |
| La caja no cuadra                          | Cierra igual con la nota que explique la diferencia: queda en la auditoría y en el exporte "Cajas y arqueos". Revisa las ventas de esa caja en `/ventas`.                                                     |
| Se cobró mal una venta                     | `/ventas` → anular con motivo y PIN de administrador (solo mientras la caja siga abierta) y volver a cobrar bien.                                                                                             |
| Se cerró la caja con una venta mal cobrada | Una caja cerrada no se modifica. Registra la corrección en la caja siguiente con una nota clara.                                                                                                              |
| La impresora no imprime                    | Revisa papel y encendido, que el navegador tenga elegida la impresora térmica y los márgenes en "Ninguno". El tiquete se reimprime desde `/ventas`.                                                           |
| "Sin conexión en vivo" en el panel         | El panel sigue funcionando y se actualiza cada 30 segundos. Si dura mucho, revisa que WebSockets esté activo en Cloudflare.                                                                                   |
| El sistema no carga                        | Revisa `/estado`, los monitores de UptimeRobot y los logs de Render.                                                                                                                                          |
| Se perdieron o dañaron datos               | Suspende la API en Render y restaura el último respaldo (ver "Respaldos").                                                                                                                                    |
| Sospecha de acceso indebido                | Usuarios → desactiva la cuenta o restablece su contraseña: sus sesiones se cierran al instante. Revisa la Auditoría (ingresos, IP y cambios). Cambia también la contraseña de Atlas si pudo haberse expuesto. |

## Seguridad

Implementado desde la Fase 0:

- **Headers:**
  - helmet en la API.
  - En el POS (vía `vercel.json`): CSP estricta, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy` y `Permissions-Policy`.
- **CORS estricto:** solo los orígenes configurados, con credenciales.
- **Verificación de origen:** header secreto de Cloudflare, lo que evita saltarse el WAF por `*.onrender.com`.
- **Rate limiting por IP real:** usa `CF-Connecting-IP` detrás de Cloudflare. Los health checks quedan excluidos.
- **Inyección NoSQL:**
  - Se rechazan cuerpos con claves `$…`, con punto o `__proto__`.
  - Mongoose usa `sanitizeFilter` y `strictQuery`.
  - Express 5 usa el parser de query simple.
  - Todas las entradas se validan con Zod.
- **Límites y errores:** el cuerpo JSON se limita a 100 kb. Los errores se responden sin stack traces en producción y con un `requestId` para rastrearlos.
- **Logs:** estructurados en JSON. Nunca registran headers, cookies, contraseñas, PIN ni tokens.
- **Variables de entorno:** se validan al arrancar. Producción exige `CORS_ORIGINS` con https y `ORIGIN_VERIFY_SECRET`.
- **Sin secretos en el repositorio:** `.env` ignorados y un `.env.example` por app.
- **Dependencias:** pnpm solo permite scripts de instalación de paquetes aprobados y rechaza versiones publicadas hace menos de un día.

Implementado en la Fase 1A (autenticación):

- **Contraseñas y PIN** cifrados con argon2id (parámetros de OWASP). Nunca se guardan ni se registran en texto plano.
- **Política de contraseñas:** mínimo 8 caracteres, se rechazan las comunes y las que contienen el usuario. PIN de 6 números sin secuencias ni repeticiones.
- **Sesión en cookies** `httpOnly`, `Secure` y `SameSite=Lax`, solo para `api.panesypan.com` (prefijos `__Host-` / `__Secure-`):
  - Token de acceso de 10 minutos.
  - Token de refresco rotativo que solo viaja a `/api/v1/auth`.
- **Detección de robo de sesión:** si se reutiliza un token de refresco viejo, se cierra la sesión y queda una alerta en la auditoría.
- **La sesión se valida en la base de datos en cada petición:** cerrar sesión, desactivar un usuario o cambiarle la contraseña tiene efecto inmediato.
- **CSRF:** token ligado a la sesión en el header `X-CSRF-Token`, más verificación de `Origin` en toda petición que modifica datos.
- **Bloqueo de cuenta** tras 5 contraseñas incorrectas durante 15 minutos (el administrador puede desbloquearla), más un límite de intentos por IP.
- **Mensajes que no revelan información:** usuario inexistente y contraseña incorrecta reciben el mismo mensaje y tardan lo mismo.
- **Bloqueo de pantalla** tras 10 minutos sin uso. Se desbloquea con el PIN; tras 5 PIN incorrectos se cierra la sesión.
- **Duración de la sesión:** 16 horas para cajeras (un turno) y 30 días para el administrador.
- **Contraseñas temporales** al crear o restablecer usuarios: se muestran una sola vez y obligan a cambiarlas.
- **RBAC** validado en el backend: las cajeras no pueden gestionar usuarios ni ver la auditoría. Siempre debe quedar al menos un administrador activo.
- **Auditoría de solo inserción:** ingresos, intentos fallidos, bloqueos, cambios de contraseña/PIN y cambios de usuarios, con IP y hora.

Implementado en la Fase 1F (tiempo real y reportes):

- **Socket.IO con las mismas reglas que la API REST**, en `/api/realtime`: solo orígenes de `CORS_ORIGINS` (el WebSocket no lo cubre CORS, así que se verifica el `Origin` a mano), header secreto de Cloudflare y sesión válida en la base de datos.
- **Solo el administrador** (permiso `reports:read`) puede conectarse. La sesión se revalida cada minuto: cerrar sesión o desactivar al usuario corta el socket.
- **El socket no transporta datos de negocio**, solo un aviso "algo cambió".
- **Exportes:** exigen `reports:read`, limitan el rango y las filas, neutralizan fórmulas de Excel y quedan en la auditoría (`REPORT_EXPORTED`).
- **PWA:** el service worker no guarda respuestas de la API.

Implementado en la Fase 1G (revisión de seguridad):

- **Matriz de acceso probada:** una prueba recorre todas las rutas registradas en Express y verifica que cada una exija sesión y el permiso correcto para cada rol. Si alguien agrega una ruta sin declararla en la matriz, la prueba falla.
- **Caja sin condiciones de carrera:** cobrar, anular, registrar egresos o retiros y cerrar la caja escriben el mismo documento de la caja dentro de su transacción, así MongoDB serializa las operaciones que chocan. Antes, una venta cobrada justo mientras se cerraba la caja podía quedar fuera del arqueo, y dos retiros simultáneos podían sacar más efectivo del que había. Ahora hay pruebas que reproducen ambos casos.
- **Consulta de ventas acotada:** una cajera solo puede consultar las ventas de su caja abierta y las cuentas de mesa abiertas, igual que en el listado. El historial completo es del administrador.
- **Cobro idempotente también en mesas:** reutilizar el identificador de un cobro ya registrado responde `409` en lugar de un error interno.
- **Revisión de dependencias:** `pnpm audit` sin vulnerabilidades conocidas.
- **Respaldos y restauración** con confirmación explícita del nombre de la base (ver "Respaldos").

Implementado en la Fase 1H (facturación electrónica):

- **Credenciales del proveedor solo en el servidor:** variables `FACTUS_*`, validadas al arrancar (las cuatro juntas). Nunca van a la base de datos, a la pantalla ni a los logs.
- **Permiso propio** `einvoice:manage` (solo administrador) para ver documentos y reenviarlos; los reenvíos quedan en la auditoría (`EINVOICE_RETRIED`).
- **Sin pérdidas ni duplicados:** la factura se encola en la misma transacción que la venta, y cada documento tiene un código de referencia único ante el proveedor.
- **Datos del proveedor tratados como no confiables:** los enlaces públicos solo se aceptan si son `https://`, y los mensajes de error se acortan antes de guardarlos.
- **Datos del cliente validados** con Zod (tipo y número de documento, dígito de verificación del NIT y correo).

Al cierre de cada fase se hace una revisión de seguridad.

## Roadmap

| Fase | Alcance                                                                                                        | Estado |
| ---- | -------------------------------------------------------------------------------------------------------------- | ------ |
| 0    | Monorepo, tooling, paquete compartido, API con health checks, MongoDB, keep-alive, configuración de despliegue | ✅     |
| 1A   | Autenticación, RBAC, usuarios, primer administrador, auditoría                                                 | ✅     |
| 1B   | Catálogo (categorías, productos, precios, agotados) y menú del día                                             | ✅     |
| 1C   | Apertura de caja y POS: ventas, pagos mixtos, mesas, tiquete                                                   | ✅     |
| 1D   | Caja: egresos, retiros, arqueo por denominaciones y cierre                                                     | ✅     |
| 1E   | Inventario básico, producción, mermas y alertas                                                                | ✅     |
| 1F   | Dashboard, estadísticas, tiempo real, PWA y exportes                                                           | ✅     |
| 1G   | Revisión de seguridad, pruebas, pulido y guía de producción                                                    | ✅     |
| 1H   | Facturación electrónica DIAN (factura de venta y nota crédito, proveedor Factus): lista, **sin activar**       | ✅     |
| 2    | Web pública (Next.js, SEO local) y domicilios en tiempo real                                                   | ⏳     |
| 3    | Pedidos web cobrados como venta, almuerzos por la web, avisos, comanda y reportes web vs. local                | ✅     |

## Convención de commits

Se usa [Conventional Commits](https://www.conventionalcommits.org/es/), en español y breve (máximo ~70 caracteres):

```text
<tipo>(<alcance opcional>): <descripción en minúscula>

feat(caja): apertura y cierre de caja con arqueo
fix(pos): corrige el cálculo del cambio en pagos mixtos
```

Tipos permitidos: `feat`, `fix`, `refactor`, `style`, `docs`, `test`, `chore`, `build`, `ci`, `perf`, `security`.

Antes de cada commit: `pnpm check`.

## Licencia

Copyright © 2026 Panes & Pan. **Todos los derechos reservados.** Software privado; consulta el archivo [LICENSE](LICENSE).
