# Panes & Panes · Sistema POS y plataforma web

Punto de venta, panel administrativo y (próximamente) web pública con domicilios para **Panes & Panes**, panadería en Dosquebradas, Risaralda (Colombia).

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
- [Despliegue](#despliegue)
- [Seguridad](#seguridad)
- [Roadmap](#roadmap)
- [Convención de commits](#convención-de-commits)
- [Licencia](#licencia)

---

## El negocio y el problema

Panes & Panes vende panadería y repostería (pan, pandebonos, buñuelos, tortas), bebidas (café, chocolate, jugos, gaseosas), almuerzos (menú del día y ejecutivo) y caldos en la mañana. Cuenta con **8 mesas** además de la venta en mostrador y para llevar.

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
├─ scripts/                   Keep-alive de la BD y MongoDB local de desarrollo
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

**Sobre la base de datos local (`pnpm dev:db`):**

- Levanta un replica set de un nodo en `127.0.0.1:27017`, que es lo que exigen las transacciones.
- Guarda los datos en `.local/mongo` y los conserva entre reinicios.
- La primera vez descarga el binario de MongoDB, lo que tarda uno o dos minutos.
- Detenla con `Ctrl+C`. Si cerraste la terminal y quedó corriendo en segundo plano, apágala con `pnpm dev:db:stop`.

## Variables de entorno

Los archivos `.env` **nunca** se suben al repositorio. Cada app tiene su `.env.example` con valores de ejemplo.

### API (`backend/.env`)

| Variable               | Descripción                                                                                                 | Ejemplo                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `NODE_ENV`             | `development`, `test` o `production`                                                                        | `development`                                           |
| `PORT`                 | Puerto HTTP (Render lo define solo)                                                                         | `4000`                                                  |
| `LOG_LEVEL`            | Nivel de logs de pino                                                                                       | `info`                                                  |
| `MONGODB_URI`          | Cadena de conexión a MongoDB                                                                                | `mongodb+srv://USUARIO:CLAVE@cluster.xxxxx.mongodb.net` |
| `MONGODB_DB_NAME`      | Nombre de la base de datos                                                                                  | `panesypan`                                             |
| `CORS_ORIGINS`         | Orígenes permitidos, separados por coma. En producción es obligatorio y todos deben usar https              | `https://sistema.panesypan.com`                         |
| `TRUST_PROXY_HOPS`     | Proxies de confianza (0 en local, 1 en Render)                                                              | `1`                                                     |
| `ORIGIN_VERIFY_SECRET` | Secreto del header `X-Origin-Verify` que agrega Cloudflare. Obligatorio en producción, mínimo 32 caracteres | `(generado, ver abajo)`                                 |
| `RATE_LIMIT_WINDOW_MS` | Ventana del límite general, en ms                                                                           | `60000`                                                 |
| `RATE_LIMIT_MAX`       | Peticiones por IP en esa ventana                                                                            | `600`                                                   |
| `AUTH_RATE_LIMIT_MAX`  | Intentos fallidos de login o PIN por IP cada 15 minutos                                                     | `30`                                                    |
| `JWT_ACCESS_SECRET`    | Secreto para firmar la sesión. Obligatorio, mínimo 32 caracteres, distinto de `CSRF_SECRET`                 | `(generado)`                                            |
| `CSRF_SECRET`          | Secreto para el token anti-CSRF. Obligatorio, mínimo 32 caracteres                                          | `(generado)`                                            |
| `SEED_ADMIN_USERNAME`  | Usuario del primer administrador (solo se usa si no existe ninguno)                                         | `admin`                                                 |
| `SEED_ADMIN_PASSWORD`  | Contraseña inicial del primer administrador; se cambia en el primer ingreso. Bórrala después                | `(una frase larga)`                                     |
| `SEED_ADMIN_NAME`      | Nombre visible del primer administrador (opcional)                                                          | `Administrador`                                         |
| `SEED_ADMIN_EMAIL`     | Correo del primer administrador (opcional)                                                                  | `duena@correo.com`                                      |

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
| `pnpm check`                        | typecheck + lint + formato + pruebas (correr antes de cada commit)           |
| `pnpm db:keepalive`                 | Ping y escritura mínima a MongoDB (keep-alive de Atlas)                      |

Cada paquete también tiene sus propios `dev`, `build`, `typecheck`, `lint` y `test`. Se pueden correr con `npm run <script>` dentro de la carpeta (`backend`, `frontend` o `packages/shared`), o desde la raíz con `pnpm --filter @panesypan/backend test`.

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
   - Build: `npm install -g pnpm@12.5.1 && NODE_ENV=development pnpm install --frozen-lockfile && pnpm --filter @panesypan/backend build`
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

Al cierre de cada fase se hace una revisión de seguridad.

## Roadmap

| Fase | Alcance                                                                                                        | Estado |
| ---- | -------------------------------------------------------------------------------------------------------------- | ------ |
| 0    | Monorepo, tooling, paquete compartido, API con health checks, MongoDB, keep-alive, configuración de despliegue | ✅     |
| 1A   | Autenticación, RBAC, usuarios, primer administrador, auditoría                                                 | ✅     |
| 1B   | Catálogo, impuestos, configuración y menú del día                                                              | ⏳     |
| 1C   | Apertura de caja y POS: ventas, pagos mixtos, mesas, tiquete                                                   | ⏳     |
| 1D   | Caja: egresos, retiros, arqueo por denominaciones y cierre                                                     | ⏳     |
| 1E   | Inventario básico, producción, mermas y alertas                                                                | ⏳     |
| 1F   | Dashboard, estadísticas, tiempo real, PWA y exportes                                                           | ⏳     |
| 1G   | Revisión de seguridad, pruebas, pulido y guía de producción                                                    | ⏳     |
| 2    | Web pública (Next.js, SEO local) y domicilios en tiempo real                                                   | ⏳     |

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

Copyright © 2026 Panes & Panes. **Todos los derechos reservados.** Software privado; consulta el archivo [LICENSE](LICENSE).
