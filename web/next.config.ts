import type { NextConfig } from 'next';

type RemotePattern = NonNullable<NonNullable<NextConfig['images']>['remotePatterns']>[number];

/** Fotos de productos en Cloudinary (las nuevas) y en la API (las antiguas). */
const CLOUDINARY_ORIGIN = 'https://res.cloudinary.com';
const CLOUDINARY_PATTERN: RemotePattern = {
  protocol: 'https',
  hostname: 'res.cloudinary.com',
  pathname: '/**',
};

function apiImagePatterns(): RemotePattern[] {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (!raw) return [CLOUDINARY_PATTERN];
  try {
    const url = new URL(raw);
    return [
      {
        protocol: url.protocol === 'http:' ? 'http' : 'https',
        hostname: url.hostname,
        port: url.port,
        pathname: '/api/v1/public/images/**',
      },
      CLOUDINARY_PATTERN,
    ];
  } catch {
    return [CLOUDINARY_PATTERN];
  }
}

/** Origen de la API (sin ruta) para img-src y connect-src de la CSP. */
function apiOrigin(): string {
  try {
    return process.env.NEXT_PUBLIC_API_URL ? new URL(process.env.NEXT_PUBLIC_API_URL).origin : '';
  } catch {
    return '';
  }
}

/**
 * CSP sin nonce: Next inyecta scripts en línea para la hidratación, por eso script-src
 * necesita 'unsafe-inline'. El mapa de contacto es un iframe de Google Maps.
 */
function contentSecurityPolicy(): string {
  const api = apiOrigin();
  const dev = process.env.NODE_ENV !== 'production';
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${CLOUDINARY_ORIGIN}${api ? ` ${api}` : ''}`,
    "font-src 'self'",
    `connect-src 'self'${api ? ` ${api}` : ''}`,
    'frame-src https://www.google.com https://maps.google.com',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@panesypan/shared'],
  images: {
    remotePatterns: apiImagePatterns(),
  },
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
          },
        ],
      },
    ]);
  },
};

export default nextConfig;
