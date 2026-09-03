import { notFound } from 'next/navigation';
import { shopBySlug, allShops } from '@/core/store';
import { GiftFlow } from './GiftFlow';

export function generateStaticParams() {
  return allShops().map((s) => ({ slug: s.slug }));
}

export default function GiftPage({ params }: { params: { slug: string } }) {
  const shop = shopBySlug(params.slug);
  if (!shop) notFound();
  return (
    <GiftFlow
      shop={{ id: shop.id, slug: shop.slug, name: shop.name, emoji: shop.emoji, address: shop.address }}
    />
  );
}
