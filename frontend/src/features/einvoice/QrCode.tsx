import { useMemo, type CSSProperties } from 'react';
import { encode } from 'uqr';

/**
 * Código QR en SVG (negro sobre blanco, nítido al imprimir). Se genera en el navegador, sin
 * enviar el contenido a ningún servicio externo.
 */
export function QrCode({
  value,
  label,
  className,
  style,
}: {
  value: string;
  label: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { path, size } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 });
    let d = '';
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${String(x)} ${String(y)}h1v1h-1z`;
      });
    });
    return { path: d, size: qr.size };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      shapeRendering="crispEdges"
      className={className}
      style={style}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
