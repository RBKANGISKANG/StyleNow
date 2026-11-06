/**
 * The props each shop page hands its client view, built in one place so the
 * pre-rendered routes and the client-side fallback (/shops/view, for salons
 * registered after the static build) can never disagree.
 */
import type { SeedShop } from '@/core/seed';

export function shopDetailData(shop: SeedShop) {
  return {
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    category: shop.category,
    tagline: shop.tagline,
    about: shop.about,
    address: shop.address,
    district: shop.district,
    lat: shop.lat,
    lng: shop.lng,
    gradient: shop.gradient,
    emoji: shop.emoji,
    languagesSpoken: shop.languagesSpoken,
    ratingAvg: shop.ratingAvg,
    ratingCount: shop.ratingCount,
    isNew: shop.isNew,
    isMobile: shop.isMobile,
    kidsFriendly: shop.kidsFriendly ?? false,
    premium: shop.premium ?? false,
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
      adultsOnly: s.adultsOnly ?? false,
    })),
    staff: shop.staff.map((s) => ({ id: s.id, name: s.name, role: s.role, tier: s.tier })),
    reviews: shop.reviews,
  };
}

export function bookFlowData(shop: SeedShop) {
  return {
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
          requiresPatchTest: s.requiresPatchTest ?? false,
          consultationFirst: s.consultationFirst ?? false,
          adultsOnly: s.adultsOnly ?? false,
        })),
        staff: shop.staff.map((s) => ({ id: s.id, name: s.name, role: s.role })),
      };
}

export function giftData(shop: SeedShop) {
  return { id: shop.id, slug: shop.slug, name: shop.name, emoji: shop.emoji, address: shop.address };
}
