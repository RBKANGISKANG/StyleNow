'use client';
/**
 * Where the salon actually is.
 *
 * An address is a string; a map is an answer to "is this on my way home?".
 * The page has carried the coordinates in its seed data all along and never
 * showed them.
 *
 * OpenStreetMap rather than Google Maps for the picture: Google's embed needs a
 * billed API key, and a map that fails closed on a missing key is worse than no
 * map. OSM's embed needs nothing, so this works the moment it ships. The
 * *directions* link still goes to Google Maps — that is a plain URL with no key,
 * and it is what most people have set as their default anyway.
 *
 * The iframe is loaded lazily and only drawn once the section is on screen:
 * a map nobody scrolled to should not cost a tile request.
 */
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';

/** Roughly 300 m across at Berlin's latitude — close enough to see the street. */
const SPAN = 0.004;

export function ShopMap({
  name,
  address,
  lat,
  lng,
}: {
  name: string;
  address: string;
  lat: number;
  lng: number;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  // A blank grey rectangle is the worst possible answer to "where is this?".
  // Offline, a tracker blocker, or a network that refuses the embed all end the
  // same way, so the frame gives up after a few seconds and says so — the
  // address and the directions link are plain HTML and never depend on it.
  const [state, setState] = useState<'waiting' | 'ok' | 'failed'>('waiting');

  useEffect(() => {
    if (!visible || state !== 'waiting') return;
    const t = setTimeout(() => setState((s) => (s === 'waiting' ? 'failed' : s)), 6000);
    return () => clearTimeout(t);
  }, [visible, state]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const bbox = [lng - SPAN, lat - SPAN / 2, lng + SPAN, lat + SPAN / 2].join('%2C');
  const embed = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const osm = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;

  return (
    <div className="shop-map" ref={box}>
      <div className="shop-map-frame">
        {state === 'failed' ? (
          <div className="shop-map-out">
            <Icon name="pin" size={22} />
            <span>{t('map_unavailable')}</span>
          </div>
        ) : visible ? (
          <>
            {state === 'waiting' && <div className="shop-map-skeleton" />}
            <iframe
              title={t('map_of', { shop: name })}
              src={embed}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              onLoad={() => setState('ok')}
              style={state === 'ok' ? undefined : { visibility: 'hidden' }}
            />
          </>
        ) : (
          <div className="shop-map-skeleton" />
        )}
      </div>
      <div className="shop-map-bar">
        <span className="shop-map-addr">
          <Icon name="pin" size={15} />
          {address}
        </span>
        <span className="shop-map-links">
          <a className="btn btn-soft sm" href={directions} target="_blank" rel="noreferrer noopener">
            {t('map_directions')}
          </a>
          <a className="shop-map-osm" href={osm} target="_blank" rel="noreferrer noopener">
            {t('map_bigger')}
          </a>
        </span>
      </div>
    </div>
  );
}
