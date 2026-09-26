import type { NextConfig } from 'next';

type RemotePattern = NonNullable<NonNullable<NextConfig['images']>['remotePatterns']>[number];

/** Las fotos de productos las sirve la API: se permite solo su origen. */
function apiImagePatterns(): RemotePattern[] {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (!raw) return [];
  try {
    const url = new URL(raw);
    return [
      {
        protocol: url.protocol === 'http:' ? 'http' : 'https',
        hostname: url.hostname,
        port: url.port,
        pathname: '/api/v1/public/images/**',
      },
    ];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@panesypan/shared'],
  images: {
    remotePatterns: apiImagePatterns(),
  },
};

export default nextConfig;
