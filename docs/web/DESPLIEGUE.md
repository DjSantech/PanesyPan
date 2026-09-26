# Despliegue de la web pública (panesypan.com)

Checklist para publicar `web/` en Vercel con el dominio `panesypan.com`. La API sigue en Render
detrás de Cloudflare (`api.panesypan.com`) y el panel POS en `sistema.panesypan.com`.

## 1. Vercel

- [ ] Nuevo proyecto importando el repositorio; **Root Directory: `web`**.
- [ ] Framework Next.js (lo fija `web/vercel.json`: instala con `pnpm install --frozen-lockfile`
      y construye con `pnpm build`). Mantener activo "Include files outside the root directory"
      para que compile `packages/shared`.
- [ ] Variables de entorno (Production y Preview):
  - `NEXT_PUBLIC_API_URL=https://api.panesypan.com`
  - `NEXT_PUBLIC_SITE_URL=https://panesypan.com`
- [ ] Dominios: `panesypan.com` (principal) y `www.panesypan.com` con redirección 308 al apex.

## 2. DNS en Cloudflare

- [ ] Crear los registros que muestra Vercel (normalmente `A @ 76.76.21.21` y
      `CNAME www cname.vercel-dns.com`; usar los que indique su panel).
- [ ] **Proxy desactivado (nube gris, "DNS only")** en esos registros: Vercel emite su propio
      certificado y sirve su CDN.
- [ ] `api` sigue con proxy activado (nube naranja): la regla de Cloudflare agrega
      `X-Origin-Verify` y la API rechaza lo que no la traiga.

## 3. Render (API)

- [ ] `CORS_ORIGINS=https://sistema.panesypan.com,https://panesypan.com,https://www.panesypan.com`
      (sin barra final). Redesplegar tras cambiarla.
- [ ] Comprobar que la web llama a `https://api.panesypan.com` (vía Cloudflare) y nunca a la URL
      `*.onrender.com`: sin la cabecera secreta, `originVerify` responde 403.

## 4. Headers de seguridad

Salen de `web/next.config.ts` (CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy,
X-Frame-Options). Comprobar con `curl -I https://panesypan.com` y la consola del navegador: sin
violaciones de CSP en inicio, catálogo, menú, pedido y contacto (mapa de Google).

## 5. Buscadores

- [ ] Google Search Console: propiedad de dominio `panesypan.com` (registro TXT en Cloudflare).
- [ ] Enviar `https://panesypan.com/sitemap.xml` y revisar `https://panesypan.com/robots.txt`.

## 6. Pruebas después de desplegar

- [ ] El catálogo muestra productos y fotos reales de la API.
- [ ] El menú del día aparece cuando está publicado en el POS.
- [ ] Pedido de prueba desde `/pedido`: aparece en `/pedidos-web` del panel con aviso en vivo;
      después cancelarlo o marcarlo como entregado.
- [ ] `www.panesypan.com` redirige a `panesypan.com` y el certificado es válido en ambos.
