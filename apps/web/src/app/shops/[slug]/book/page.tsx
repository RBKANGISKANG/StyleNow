import { notFound } from 'next/navigation';
import { shopBySlug, allShops } from '@/core/store';
import { BookFlow } from './BookFlow';

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
      shop={{
        id: shop.id,
        slug: shop.slug,
        name: shop.name,
        emoji: shop.emoji,
        gradient: shop.gradient,
        depositPercent: shop.depositPercent,
        policy: shop.policy,
        isMobile: shop.isMobile,
        services: shop.services.map((s) => ({
          id: s.id,
          emoji: s.emoji,
          name: s.name,
          durationMin: s.durationMin,
          processingGapMin: s.processingGapMin,
          finishMin: s.finishMin,
          basePriceCents: s.basePriceCents,
          dynamicPricing: s.dynamicPricing,
          popular: s.popular ?? false,
        })),
        staff: shop.staff.map((s) => ({ id: s.id, name: s.name, role: s.role })),
      }}
    />
  );
}
