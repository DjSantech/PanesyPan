import { getSiteUrl } from '@/lib/seo/site';
import type { MetadataRoute } from 'next';

// (sin cambios de comportamiento; solo para forzar un nuevo despliegue)

export default function robots(): MetadataRoute.Robots {
  const url = getSiteUrl();
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${url}/sitemap.xml`,
  };
}
