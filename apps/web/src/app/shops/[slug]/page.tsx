import { notFound } from 'next/navigation';
import { shopBySlug, allShops } from '@/core/store';
import { ShopDetail } from './ShopDetail';
import { shopDetailData } from '@/lib/shop-data';

export function generateStaticParams() {
  return allShops().map((s) => ({ slug: s.slug }));
}

export default async function ShopPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const shop = shopBySlug(params.slug);
  if (!shop) notFound();

  // Serialize exactly what the client view needs.
  const data = shopDetailData(shop);

  return <ShopDetail shop={data} />;
}
