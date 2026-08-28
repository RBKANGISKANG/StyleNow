'use client';
/**
 * The feed, on a map.
 *
 * "Which of these is actually near me?" is the one question a ranked list
 * cannot answer. Distance in metres is an abstraction; a pin two streets away
 * is not. So the same result set the list renders gets a third view where every
 * salon is a pin and tapping one opens the card.
 *
 * There is no map library and no API key here on purpose. Web Mercator is
 * fifteen lines of arithmetic, and raster tiles are just images at computed
 * offsets — a dependency-free map that ships today beats a keyed one that ships
 * when somebody sets up billing. Tiles come from OpenStreetMap, which the ODbL
 * requires us to credit, and the credit is in the corner.
 *
 * The important part is what happens when the tiles do not arrive — a blocked
 * request, an offline phone, a strict extension. The pins are *ours*: they are
 * drawn from coordinates we already hold, positioned by our own projection. So
 * when the imagery fails the map degrades to a plain plot on a tinted ground —
 * still the right relative geography, still tappable, just without the streets.
 * A grey rectangle would have been the alternative.
 *
 * One operational note: openstreetmap.org's own tile servers are a volunteer
 * resource with a usage policy that asks for light, browser-shaped traffic —
 * fine for a demo and for one screen of tiles at a time, but a real launch
 * should point TILE_HOST at a paid tile provider or a self-hosted renderer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { money, distance } from '@/lib/format';
import { Icon } from '@/components/Icon';

/** Swap this for a paid or self-hosted `{z}/{x}/{y}.png` endpoint at launch. */
const TILE_HOST = 'https://tile.openstreetmap.org';
const TILE = 256;
const MIN_Z = 10;
const MAX_Z = 17;
/**
 * Room to leave around the outermost pins when fitting. A pin is ~50×60px of
 * ink hanging off its coordinate, so a flat inset would crop the edge ones —
 * but a fixed 64px on a phone throws away a third of the width and leaves every
 * salon in one unreadable knot, so it scales with the box.
 */
function padding(w: number, h: number): { x: number; y: number } {
  return { x: Math.min(60, w * 0.14), y: Math.min(72, h * 0.16) };
}

export interface MapPin {
  shopId: string;
  slug: string;
  name: string;
  district: string;
  lat: number;
  lng: number;
  emoji: string;
  logoUrl: string | null;
  ratingAvg: number;
  ratingCount: number;
  priceFromCents: number;
  distanceM: number;
  minutesToFirstSlot: number | null;
}

/** Web Mercator, in pixels of the whole world at this zoom. */
function project(lat: number, lng: number, z: number): { x: number; y: number } {
  const scale = TILE * 2 ** z;
  const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

interface Camera {
  z: number;
  /** Centre of the viewport, in world pixels at z. */
  cx: number;
  cy: number;
}

/** The tightest zoom that still shows every pin inside the box. */
function fit(pins: MapPin[], w: number, h: number): Camera {
  const lats = pins.map((p) => p.lat);
  const lngs = pins.map((p) => p.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

  const pad = padding(w, h);
  let z = MAX_Z;
  for (; z > MIN_Z; z--) {
    const xs = pins.map((p) => project(p.lat, p.lng, z));
    const spanX = Math.max(...xs.map((p) => p.x)) - Math.min(...xs.map((p) => p.x));
    const spanY = Math.max(...xs.map((p) => p.y)) - Math.min(...xs.map((p) => p.y));
    if (spanX <= w - pad.x * 2 && spanY <= h - pad.y * 2) break;
  }
  const c = project(midLat, midLng, z);
  return { z, cx: c.x, cy: c.y };
}

export function FeedMap({ pins }: { pins: MapPin[] }) {
  const { t, lang } = useI18n();
  const box = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [cam, setCam] = useState<Camera | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // Have any tiles actually arrived? Until one does we are one failed request
  // away from a blank rectangle, so the fallback ground stays painted.
  const [tiles, setTiles] = useState<'waiting' | 'ok' | 'failed'>('waiting');

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (tiles !== 'waiting') return;
    const timer = setTimeout(() => setTiles((s) => (s === 'waiting' ? 'failed' : s)), 9000);
    return () => clearTimeout(timer);
  }, [tiles]);

  // Refit when the result set changes — a filtered feed is a different city.
  const key = pins.map((p) => p.shopId).join(',');
  useEffect(() => {
    if (!size || size.w === 0 || pins.length === 0) return;
    setCam(fit(pins, size.w, size.h));
    setPicked(null);
    // pins is re-derived on every render; key is the stable identity of the set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, size?.w, size?.h]);

  // Dragging moves the camera, not the tiles: everything else is a projection
  // of the camera, so pins and imagery can never drift apart.
  //
  // The move and release listeners go on the window rather than through
  // setPointerCapture, which would redirect every later event — including the
  // click — to the canvas and leave the pins untappable.
  const drag = useRef<{ x: number; y: number } | null>(null);
  // A drag that ends over a pin is a drag, not a tap on that pin.
  const dragged = useRef(false);

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    drag.current = { x: e.clientX, y: e.clientY };
    dragged.current = false;

    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = ev.clientX - d.x;
      const dy = ev.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragged.current = true;
      d.x = ev.clientX;
      d.y = ev.clientY;
      setCam((c) => (c ? { ...c, cx: c.cx - dx, cy: c.cy - dy } : c));
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const zoomBy = useCallback(
    (delta: number) => {
      setCam((c) => {
        if (!c) return c;
        const z = Math.min(MAX_Z, Math.max(MIN_Z, c.z + delta));
        if (z === c.z) return c;
        const f = 2 ** (z - c.z);
        return { z, cx: c.cx * f, cy: c.cy * f };
      });
    },
    [],
  );

  const placed = useMemo(() => {
    if (!cam || !size) return [];
    const left = cam.cx - size.w / 2;
    const top = cam.cy - size.h / 2;
    return pins.map((p) => {
      const q = project(p.lat, p.lng, cam.z);
      return { pin: p, x: q.x - left, y: q.y - top };
    });
  }, [pins, cam, size]);

  const grid = useMemo(() => {
    if (!cam || !size) return [];
    const n = 2 ** cam.z;
    const left = cam.cx - size.w / 2;
    const top = cam.cy - size.h / 2;
    const out: { key: string; url: string; left: number; top: number }[] = [];
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + size.w) / TILE); tx++) {
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + size.h) / TILE); ty++) {
        if (ty < 0 || ty >= n) continue;
        const wrapped = ((tx % n) + n) % n;
        out.push({
          key: `${cam.z}/${tx}/${ty}`,
          url: `${TILE_HOST}/${cam.z}/${wrapped}/${ty}.png`,
          left: tx * TILE - left,
          top: ty * TILE - top,
        });
      }
    }
    return out;
  }, [cam, size]);

  const chosen = placed.find((p) => p.pin.shopId === picked)?.pin ?? null;

  return (
    <div className="feed-map">
      <div
        className={`fm-canvas${tiles === 'ok' ? '' : ' bare'}`}
        ref={box}
        onPointerDown={onDown}
      >
        {/* The tiles stay mounted even after we have given up on them: a slow
            network that arrives at second twelve should quietly become a map,
            not stay a grid because a timer fired first. */}
        {grid.map((tile) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={tile.key}
            className="fm-tile"
            src={tile.url}
            alt=""
            draggable={false}
            style={{ left: tile.left, top: tile.top }}
            onLoad={() => setTiles('ok')}
          />
        ))}

        {placed.map(({ pin, x, y }) => (
          <button
            key={pin.shopId}
            className={`fm-pin${picked === pin.shopId ? ' on' : ''}`}
            // Southern pins draw over northern ones, the way a map of a street
            // stacks: whatever is nearer the bottom is nearer the viewer. Two
            // salons in the same block will always overlap somewhat; this at
            // least makes which one wins predictable instead of array order.
            style={{
              left: x,
              top: y,
              zIndex: picked === pin.shopId ? 700 : 1 + Math.round(Math.min(Math.max(y, 0), 600)),
            }}
            title={pin.name}
            aria-label={pin.name}
            onClick={(e) => {
              e.stopPropagation();
              if (dragged.current) return;
              setPicked(picked === pin.shopId ? null : pin.shopId);
            }}
          >
            <span className="fm-dot">
              {pin.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pin.logoUrl} alt="" />
              ) : (
                pin.emoji
              )}
            </span>
            <span className="fm-price">{money(pin.priceFromCents, lang)}</span>
          </button>
        ))}

        <div className="fm-zoom">
          <button onClick={() => zoomBy(1)} aria-label={t('map_zoom_in')} disabled={cam?.z === MAX_Z}>
            +
          </button>
          <button onClick={() => zoomBy(-1)} aria-label={t('map_zoom_out')} disabled={cam?.z === MIN_Z}>
            −
          </button>
        </div>

        {tiles === 'failed' && <div className="fm-bare-note">{t('map_plain')}</div>}

        <a className="fm-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">
          © OpenStreetMap
        </a>
      </div>

      {chosen ? (
        <Link href={`/shops/${chosen.slug}`} className="fm-peek">
          <span className="fm-peek-ico">
            {chosen.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={chosen.logoUrl} alt="" />
            ) : (
              chosen.emoji
            )}
          </span>
          <span className="fm-peek-txt">
            <strong>{chosen.name}</strong>
            <span className="fm-peek-meta">
              <span className="star">★</span> {chosen.ratingAvg.toFixed(1)} ({chosen.ratingCount}) · {chosen.district} ·{' '}
              {distance(chosen.distanceM, lang)}
            </span>
            <span className="fm-peek-meta">
              {t('from')} {money(chosen.priceFromCents, lang)}
              {chosen.minutesToFirstSlot !== null && chosen.minutesToFirstSlot <= 12 * 60 && (
                <> · ⚡ {t('next_free')} {t('in_min', { m: chosen.minutesToFirstSlot })}</>
              )}
            </span>
          </span>
          <Icon name="chevron" size={18} strokeWidth={2.4} />
        </Link>
      ) : (
        <p className="fm-hint">{t('map_tap_pin')}</p>
      )}
    </div>
  );
}
