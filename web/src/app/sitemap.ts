import { PUBLIC_PATHS, getSiteUrl } from '@/lib/seo/site';
import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const url = getSiteUrl();
  return PUBLIC_PATHS.map((path) => ({
    url: `${url}${path === '/' ? '' : path}`,
    changeFrequency: path === '/menu-del-dia' ? 'daily' : 'weekly',
    priority: path === '/' ? 1 : 0.8,
  }));
}
