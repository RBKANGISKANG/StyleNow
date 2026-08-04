import { notFound } from 'next/navigation';
import { shopBySlug } from '@/server/store';
import { todayIso, addDays } from '@/server/time';
import { BookFlow } from './BookFlow';

export default function BookPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { service?: string };
}) {
  const shop = shopBySlug(params.slug);
  if (!shop) notFound();

  const days = Array.from({ length: 12 }, (_, i) => addDays(todayIso(), i));

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
      days={days}
      initialServiceId={searchParams.service ?? null}
    />
  );
}
