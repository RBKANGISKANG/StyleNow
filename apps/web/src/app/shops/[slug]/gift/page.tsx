import { notFound } from 'next/navigation';
import { shopBySlug, allShops } from '@/core/store';
import { GiftFlow } from './GiftFlow';
import { giftData } from '@/lib/shop-data';

export function generateStaticParams() {
  return allShops().map((s) => ({ slug: s.slug }));
}

export default async function GiftPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const shop = shopBySlug(params.slug);
  if (!shop) notFound();
  return (
    <GiftFlow
      shop={giftData(shop)}
    />
  );
}
