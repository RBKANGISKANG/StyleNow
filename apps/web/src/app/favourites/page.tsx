'use client';
/**
 * The hearts, gathered. Tapping ♥ anywhere was a promise the app never kept —
 * there was no page where those salons lived. Now there is.
 */
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { useFavourites } from '@/lib/favs';
import { allShops } from '@/core/store';
import { Heart } from '@/components/Heart';

export default function FavouritesPage() {
  const { t, lang } = useI18n();
  const [favs, toggleFav] = useFavourites();
  const shops = allShops().filter((s) => favs.includes(s.id));

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="page-title">
        <h1>♥ {t('fav_title')}</h1>
      </div>
      {shops.length === 0 ? (
        <div className="empty">
          <div className="big">🤍</div>
          <p>{t('fav_empty')}</p>
          <Link href="/" className="btn btn-primary" style={{ marginTop: 14 }}>
            {t('fav_browse')}
          </Link>
        </div>
      ) : (
        shops.map((s) => (
          <div key={s.id} className="fav-row">
            <span className="fav-emoji" style={{ background: `linear-gradient(135deg, ${s.gradient[0]}, ${s.gradient[1]})` }}>
              {s.emoji}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong>{s.name}</strong>
              <span className="fav-sub">📍 {s.district} · {s.tagline[lang]}</span>
            </span>
            <Link className="btn btn-primary sm" href={`/shops/${s.slug}`}>
              {t('book')}
            </Link>
            <button className="fav-btn-inline" aria-label="unfavourite" onClick={() => toggleFav(s.id)}>
              <Heart on size={18} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}
