import { notFound } from 'next/navigation';
import { shopBySlug, allShops } from '@/server/store';
import { ShopDetail } from './ShopDetail';

export function generateStaticParams() {
  return allShops().map((s) => ({ slug: s.slug }));
}

export default function ShopPage({ params }: { params: { slug: string } }) {
  const shop = shopBySlug(params.slug);
  if (!shop) notFound();

  // Serialize exactly what the client view needs.
  const data = {
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    category: shop.category,
    tagline: shop.tagline,
    about: shop.about,
    address: shop.address,
    district: shop.district,
    gradient: shop.gradient,
    emoji: shop.emoji,
    languagesSpoken: shop.languagesSpoken,
    ratingAvg: shop.ratingAvg,
    ratingCount: shop.ratingCount,
    isNew: shop.isNew,
    isMobile: shop.isMobile,
    depositPercent: shop.depositPercent,
    policy: shop.policy,
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
    staff: shop.staff.map((s) => ({ id: s.id, name: s.name, role: s.role, tier: s.tier })),
    reviews: shop.reviews,
  };

  return <ShopDetail shop={data} />;
}
