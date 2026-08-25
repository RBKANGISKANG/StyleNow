'use client';
/**
 * Revenue trend — one series over time, so: line + soft area, not bars.
 * Bars invited a rank read on a time series; a line reads as trajectory.
 *
 * Design notes (dataviz method): one series → no legend, the heading names it;
 * labels wear ink tokens, never the series colour; grid is recessive; only the
 * best day and the latest day are direct-labelled; hover gives a crosshair and
 * a tooltip for every point; the same numbers are available as a table for
 * screen readers and for anyone who wants the values, not the shape.
 */
import { useId, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { money, weekdayShort } from '@/lib/format';

export interface RevenuePoint {
  iso: string;
  revenueCents: number;
}

const W = 640;
const H = 180;
const PAD = { top: 18, right: 16, bottom: 26, left: 12 };

export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  const { t, lang } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const gradId = useId().replace(/:/g, '');

  if (data.length === 0) return null;

  const values = data.map((d) => d.revenueCents);
  const max = Math.max(...values, 1);
  const total = values.reduce((a, b) => a + b, 0);
  const avg = Math.round(total / values.length);
  const bestIdx = values.indexOf(Math.max(...values));
  const lastIdx = values.length - 1;

  // First half vs second half — an honest trend read from the window we have.
  const half = Math.floor(values.length / 2);
  const early = values.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(half, 1);
  const late = values.slice(half).reduce((a, b) => a + b, 0) / Math.max(values.length - half, 1);
  const trendPct = early > 0 ? Math.round(((late - early) / early) * 100) : 0;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (plotW * i) / Math.max(values.length - 1, 1);
  const y = (v: number) => PAD.top + plotH - (plotH * v) / max;

  const linePath = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ');
  const areaPath = `${linePath} L ${x(lastIdx)} ${PAD.top + plotH} L ${x(0)} ${PAD.top + plotH} Z`;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.left) / plotW) * (values.length - 1));
    setHover(Math.min(Math.max(i, 0), values.length - 1));
  };

  return (
    <div className="panel">
      <div className="rv-head">
        <div>
          <div className="rv-total">{money(total, lang)}</div>
          <div className="rv-sub">
            {t('rv_avg')} {money(avg, lang)}
            {trendPct !== 0 && (
              <span className={`rv-trend ${trendPct > 0 ? 'up' : 'down'}`}>
                {trendPct > 0 ? '▲' : '▼'} {Math.abs(trendPct)} %
              </span>
            )}
          </div>
        </div>
        <div className="rv-best">
          <span className="lbl">{t('rv_best')}</span>
          <span className="val">
            {weekdayShort(data[bestIdx].iso, lang)} · {money(values[bestIdx], lang)}
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="rv-svg"
        role="img"
        aria-label={`${t('revenue_7d')}: ${money(total, lang)}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* recessive grid: baseline, mid, max */}
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + plotH * (1 - f)}
            y2={PAD.top + plotH * (1 - f)}
            className={f === 0 ? 'rv-axis' : 'rv-grid'}
          />
        ))}

        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={linePath} className="rv-line" />

        {values.map((v, i) => (
          <g key={data[i].iso}>
            <circle cx={x(i)} cy={y(v)} r={hover === i ? 6 : 4.5} className="rv-dot" />
            <text x={x(i)} y={H - 8} className="rv-xlabel">
              {weekdayShort(data[i].iso, lang)}
            </text>
          </g>
        ))}

        {/* selective direct labels: best day and latest day only */}
        {[bestIdx, lastIdx]
          .filter((i, idx, arr) => arr.indexOf(i) === idx)
          .map((i) => (
            <text key={`lbl-${i}`} x={x(i)} y={y(values[i]) - 12} className="rv-point-label">
              {money(values[i], lang)}
            </text>
          ))}

        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} className="rv-crosshair" />
            <g transform={`translate(${Math.min(Math.max(x(hover), 60), W - 60)}, ${PAD.top - 4})`}>
              <rect x={-56} y={-16} width={112} height={22} rx={7} className="rv-tip-bg" />
              <text x={0} y={0} className="rv-tip-text">
                {weekdayShort(data[hover].iso, lang)} · {money(values[hover], lang)}
              </text>
            </g>
          </>
        )}
      </svg>

      <details className="rv-table">
        <summary>{t('rv_table')}</summary>
        <table className="dash-table" style={{ marginTop: 8 }}>
          <tbody>
            {data.map((d) => (
              <tr key={d.iso}>
                <td>{weekdayShort(d.iso, lang)} · {d.iso}</td>
                <td style={{ fontWeight: 700, textAlign: 'right' }}>{money(d.revenueCents, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
