'use client';
/**
 * The salon's photos, on the salon's page.
 *
 * A strip you can swipe, and a lightbox when you want to actually look. It
 * renders nothing at all when the shop has no pictures: an empty gallery frame
 * saying "no photos" is a worse first impression than a page that simply moves
 * on to the services.
 *
 * The lightbox is keyboard-navigable and traps nothing — Escape closes,
 * arrows move, and the page underneath stops scrolling while it is open.
 */
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { apiShopPhotos } from '@/lib/api';
import type { ShopPhoto } from '@/core/store';

export function ShopGallery({ shopId }: { shopId: string }) {
  const { t } = useI18n();
  const [photos, setPhotos] = useState<ShopPhoto[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void apiShopPhotos(shopId).then((p) => {
      if (alive) setPhotos(p);
    });
    return () => {
      alive = false;
    };
  }, [shopId]);

  useEffect(() => {
    if (open === null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') setOpen((i) => (i === null ? i : (i + 1) % photos.length));
      if (e.key === 'ArrowLeft') setOpen((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, photos.length]);

  if (photos.length === 0) return null;

  return (
    <section className="section">
      <h2>{t('ph_gallery')}</h2>
      <div className="gal-strip">
        {photos.map((p, i) => (
          <button className="gal-item" key={p.id} onClick={() => setOpen(i)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.dataUrl} alt={p.caption || t('ph_alt')} loading="lazy" />
            {p.caption && <span className="gal-cap">{p.caption}</span>}
          </button>
        ))}
      </div>

      {open !== null && (
        <div className="gal-box" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <button className="gal-close" aria-label={t('ph_close')} onClick={() => setOpen(null)}>
            ✕
          </button>
          {photos.length > 1 && (
            <button
              className="gal-nav prev"
              aria-label={t('ph_prev')}
              onClick={(e) => {
                e.stopPropagation();
                setOpen((open - 1 + photos.length) % photos.length);
              }}
            >
              <Icon name="chevron" size={22} strokeWidth={2.4} style={{ transform: 'rotate(180deg)' }} />
            </button>
          )}
          <figure className="gal-figure" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photos[open].dataUrl} alt={photos[open].caption || t('ph_alt')} />
            <figcaption>
              {photos[open].caption}
              <span className="gal-of">
                {open + 1} / {photos.length}
              </span>
            </figcaption>
          </figure>
          {photos.length > 1 && (
            <button
              className="gal-nav next"
              aria-label={t('ph_next')}
              onClick={(e) => {
                e.stopPropagation();
                setOpen((open + 1) % photos.length);
              }}
            >
              <Icon name="chevron" size={22} strokeWidth={2.4} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
