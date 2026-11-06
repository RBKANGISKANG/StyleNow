/**
 * Link to a salon's page. Seeded salons are pre-rendered; a salon registered
 * after a static build has no page file, so outside server mode it is served
 * by the client-side fallback /shops/view instead of a 404.
 */
import { SHOPS } from '@/core/seed';
import { backendMode } from './api';

export function shopHref(slug: string, sub: '' | 'book' | 'gift' = '', query = ''): string {
  const q = query.replace(/^\?/, '');
  if (backendMode() === 'server' || SHOPS.some((s) => s.slug === slug)) {
    return `/shops/${slug}${sub ? `/${sub}` : ''}${q ? `?${q}` : ''}`;
  }
  const p = new URLSearchParams(q);
  p.set('slug', slug);
  if (sub) p.set('p', sub);
  return `/shops/view?${p.toString()}`;
}
