import { notFound } from 'next/navigation';
import { shopBySlug, allShops } from '@/core/store';
import { BookFlow } from './BookFlow';
import { bookFlowData } from '@/lib/shop-data';

// Static-export safe: only params.slug is used at build time; the requested
// service and the bookable day range are resolved client-side.
export function generateStaticParams() {
  return allShops().map((s) => ({ slug: s.slug }));
}

export default function BookPage({ params }: { params: { slug: string } }) {
  const shop = shopBySlug(params.slug);
  if (!shop) notFound();

  return (
    <BookFlow
      shop={bookFlowData(shop)}
    />
  );
}
