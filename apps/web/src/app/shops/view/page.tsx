'use client';
/**
 * Client-side home for salons that signed up after this build was made. The
 * pre-rendered /shops/[slug] pages only know the salons that existed at build
 * time; this one reads the salon from the live store instead.
 */
import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { shopBySlug } from '@/core/store';
import { useI18n } from '@/lib/i18n';
import { bookFlowData, giftData, shopDetailData } from '@/lib/shop-data';
import { ShopDetail } from '../[slug]/ShopDetail';
import { BookFlow } from '../[slug]/book/BookFlow';
import { GiftFlow } from '../[slug]/gift/GiftFlow';

function View() {
  const { t } = useI18n();
  const params = useSearchParams();
  const shop = shopBySlug(params.get('slug') ?? '');
  if (!shop) {
    return (
      <div className="empty">
        <div className="big">🔍</div>
        <p>{t('sv_missing')}</p>
        <Link href="/" className="btn btn-primary" style={{ marginTop: 14 }}>
          {t('fav_browse')}
        </Link>
      </div>
    );
  }
  const p = params.get('p');
  if (p === 'book') return <BookFlow shop={bookFlowData(shop)} />;
  if (p === 'gift') return <GiftFlow shop={giftData(shop)} />;
  return <ShopDetail shop={shopDetailData(shop)} />;
}

export default function ShopView() {
  return (
    <Suspense fallback={null}>
      <View />
    </Suspense>
  );
}
