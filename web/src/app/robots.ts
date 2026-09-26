import { getSiteUrl } from '@/lib/seo/site';
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const url = getSiteUrl();
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${url}/sitemap.xml`,
    host: url,
  };
}
