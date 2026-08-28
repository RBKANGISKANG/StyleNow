'use client';
/**
 * The salon's own pictures.
 *
 * Until now every shop in the marketplace was a coloured gradient with an emoji
 * on it. That is honest placeholder design, and it is also the single biggest
 * reason a listing looks unfinished: people choose a salon on how the room
 * looks. So the owner uploads their own, and the first one becomes the cover
 * everywhere — the feed card, the map card, the top of their page.
 *
 * Three things this deliberately does:
 *
 *  - It says what each picture is *for*. The first tile is labelled Cover, not
 *    just first, because "drag to reorder" teaches nothing about what changes.
 *  - It downscales before storing, and if the browser still refuses the write
 *    it says so and puts the gallery back. A photo that silently vanishes
 *    overnight is worse than an upload that failed loudly.
 *  - Captions are optional and short. "Our colour bar" under a photo of a
 *    colour bar is worth more than alt-text nobody writes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { fileToPhotoDataUrl } from '@/lib/image';
import {
  apiShopPhotos,
  apiAddShopPhoto,
  apiRemoveShopPhoto,
  apiMakeShopCover,
  apiCaptionShopPhoto,
} from '@/lib/api';
import type { ShopPhoto } from '@/core/store';

const MAX = 6;

export function PhotoManager({ shopId, onToast }: { shopId: string; onToast: (msg: string) => void }) {
  const { t } = useI18n();
  const [photos, setPhotos] = useState<ShopPhoto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    void apiShopPhotos(shopId).then(setPhotos);
  }, [shopId]);

  useEffect(load, [load]);

  const upload = async (files: FileList) => {
    const room = MAX - (photos?.length ?? 0);
    if (room <= 0) {
      onToast(t('ph_full', { n: String(MAX) }));
      return;
    }
    setBusy(true);
    let added = 0;
    for (const file of Array.from(files).slice(0, room)) {
      try {
        const dataUrl = await fileToPhotoDataUrl(file);
        const res = await apiAddShopPhoto(shopId, dataUrl);
        if (res.ok) {
          added++;
          continue;
        }
        // Stop at the first refusal — the rest will fail the same way, and six
        // identical toasts is not more informative than one.
        onToast(res.code === 'photo_storage_full' ? t('ph_no_space') : t('ph_failed'));
        break;
      } catch {
        onToast(t('ph_failed'));
        break;
      }
    }
    setBusy(false);
    load();
    if (added > 0) onToast(t(added === 1 ? 'ph_added_one' : 'ph_added', { n: String(added) }));
  };

  if (photos === null) return <div className="spinner" />;

  return (
    <div className="panel photo-panel">
      <div className="photo-head">
        <p className="photo-hint">{t('ph_hint')}</p>
        <span className="photo-count">{t('ph_count', { n: String(photos.length), max: String(MAX) })}</span>
      </div>

      <div className="photo-grid">
        {photos.map((p, i) => (
          <figure className={`photo-tile${i === 0 ? ' cover' : ''}`} key={p.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.dataUrl} alt={p.caption || t('ph_alt')} />
            {i === 0 && <span className="photo-badge">{t('ph_cover')}</span>}
            <figcaption>
              {editing === p.id ? (
                <input
                  className="photo-cap-input"
                  autoFocus
                  maxLength={90}
                  value={caption}
                  placeholder={t('ph_caption_ph')}
                  onChange={(e) => setCaption(e.target.value)}
                  onBlur={() => {
                    void apiCaptionShopPhoto(shopId, p.id, caption).then(() => {
                      setEditing(null);
                      load();
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <button
                  className={`photo-cap${p.caption ? '' : ' empty'}`}
                  onClick={() => {
                    setEditing(p.id);
                    setCaption(p.caption);
                  }}
                >
                  {p.caption || t('ph_caption_add')}
                </button>
              )}
            </figcaption>
            <div className="photo-acts">
              {i !== 0 && (
                <button
                  className="btn btn-soft sm"
                  onClick={() => void apiMakeShopCover(shopId, p.id).then(load)}
                >
                  {t('ph_make_cover')}
                </button>
              )}
              <button
                className="btn btn-ghost sm"
                aria-label={t('ph_remove')}
                title={t('ph_remove')}
                onClick={() => void apiRemoveShopPhoto(shopId, p.id).then(load)}
              >
                <Icon name="trash" size={15} strokeWidth={2} />
              </button>
            </div>
          </figure>
        ))}

        {photos.length < MAX && (
          <button className="photo-add" onClick={() => fileInput.current?.click()} disabled={busy}>
            <Icon name="image" size={22} strokeWidth={1.9} />
            <span>{busy ? t('ph_working') : t('ph_add')}</span>
            <em>{t('ph_add_sub')}</em>
          </button>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
