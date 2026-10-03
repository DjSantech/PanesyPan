# Videos tutoriales

Videos verticales (1080 × 1920, para ver en el celular) que explican cada pestaña de
**sistema.panesypan.com**, con subtítulos y voz.

## Generar los videos

```bash
pnpm videos             # todos
pnpm videos vender-1    # solo los que coincidan con el nombre del archivo
```

Los MP4 (H.264 + AAC, sirven para WhatsApp) quedan en `.local/videos/`, que no se versiona.

Requisitos:

- **Windows**: la voz es la de Windows (Sabina, español de México).
- Lo mismo que `pnpm test:e2e` (Chromium de Playwright y MongoDB en memoria; ver el README
  principal).
- La primera vez se descarga ffmpeg (unos 80 MB, paquete `ffmpeg-static`).

## Cómo funciona

1. Cada video levanta su propio entorno aislado, igual al de las pruebas de punta a punta:
   MongoDB en memoria con el catálogo real, la API y el POS. Así cada video empieza siempre
   igual, sin importar el orden. **Nunca toca la base de datos real** y los usuarios son
   ficticios (Marta Ríos, administradora; Laura Gómez, cajera).
2. Cada video es un guion en `videos/*.video.ts`: frases (subtítulo + voz) y acciones (tocar,
   escribir, resaltar).
3. Antes de grabar se ensaya el guion para narrar todas las frases. Quedan en caché en
   `.local/videos/.voz/`: si el texto no cambia, no se vuelven a generar.
4. Graba la pantalla del celular y ffmpeg arma el MP4 con la voz y el sonido de los toques.

## Escribir o cambiar un video

```ts
await d.say('Toca **Cobrar** para registrar la venta.', {
  during: () => d.tap(page.getByRole('button', { name: 'Cobrar $ 11.000' })),
});
```

- `d.say(subtítulo, opciones)`: muestra el subtítulo y lo narra. Lo que va entre `**` se resalta.
  - `voice`: lo que dice la voz si debe sonar distinto (los números, mejor en letras).
  - `focus`: elemento que se resalta mientras se dice la frase (`dim: true` oscurece el resto).
  - `during`: acciones que pasan mientras suena la frase.
- `d.tap(elemento)`, `d.type(elemento, texto)`, `d.highlight(elemento)`, `d.wait(ms)`.
- `d.select(lista, opción)`, `d.pin('123456')`, `d.scrollTo(elemento)`, `d.press('Escape')`.
- `prepare`: deja los datos listos antes de grabar (por la API, no sale en el video). Los datos
  de demostración comunes (bebidas, almuerzo, ventas del día, menú publicado, pedido web) están
  en `lib/scenario.ts`.

La voz y su velocidad se cambian en `lib/format.ts` (`VOICE`). Las voces instaladas están en
Configuración de Windows → Hora e idioma → Voz.
