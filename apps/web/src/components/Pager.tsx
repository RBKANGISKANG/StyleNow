'use client';
/**
 * Paging for the back-office tables.
 *
 * The demo shop now carries twelve weeks of trading, which is three hundred
 * customers — and a three-hundred-row table is a scroll bar, not a tool. Paging
 * keeps a page a page: you can see how many there are, land on a known row
 * number, and the browser is not laying out a thousand cells to show you thirty.
 *
 * It is deliberately dumb about the data: it takes an already-filtered,
 * already-sorted array and hands back a window. Search narrows first, paging
 * second — the other order would page through rows that no longer match.
 */
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';

export interface Paged<T> {
  page: T[];
  pageIndex: number;
  pageCount: number;
  total: number;
  setPageIndex: (i: number) => void;
}

export function usePaged<T>(rows: T[], perPage = 25, resetKey: unknown = null): Paged<T> {
  const [pageIndex, setPageIndex] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));

  // A new search or sort means page 3 of the old result set is meaningless —
  // and often past the end, which would show an empty table with rows in it.
  useEffect(() => {
    setPageIndex(0);
  }, [resetKey, rows.length]);

  const page = useMemo(
    () => rows.slice(pageIndex * perPage, pageIndex * perPage + perPage),
    [rows, pageIndex, perPage],
  );

  return { page, pageIndex: Math.min(pageIndex, pageCount - 1), pageCount, total: rows.length, setPageIndex };
}

export function Pager<T>({ paged, perPage = 25 }: { paged: Paged<T>; perPage?: number }) {
  const { t } = useI18n();
  const { pageIndex, pageCount, total, setPageIndex } = paged;
  if (total === 0) return null;

  const from = pageIndex * perPage + 1;
  const to = Math.min(total, (pageIndex + 1) * perPage);

  // Only ever a short run of numbers, centred on where you are — a hundred
  // page buttons is the same problem as a hundred rows.
  const window: number[] = [];
  const first = Math.max(0, Math.min(pageIndex - 2, pageCount - 5));
  for (let i = first; i < Math.min(pageCount, first + 5); i++) window.push(i);

  return (
    <div className="pager">
      <span className="pager-count">{t('pg_range', { from: String(from), to: String(to), total: String(total) })}</span>
      <div className="pager-btns">
        <button
          className="pager-btn"
          disabled={pageIndex === 0}
          aria-label={t('pg_prev')}
          onClick={() => setPageIndex(pageIndex - 1)}
        >
          <Icon name="chevron" size={15} strokeWidth={2.4} style={{ transform: 'rotate(180deg)' }} />
        </button>
        {window[0] > 0 && <span className="pager-gap">…</span>}
        {window.map((i) => (
          <button
            key={i}
            className={`pager-btn${i === pageIndex ? ' on' : ''}`}
            aria-current={i === pageIndex ? 'page' : undefined}
            onClick={() => setPageIndex(i)}
          >
            {i + 1}
          </button>
        ))}
        {window[window.length - 1] < pageCount - 1 && <span className="pager-gap">…</span>}
        <button
          className="pager-btn"
          disabled={pageIndex >= pageCount - 1}
          aria-label={t('pg_next')}
          onClick={() => setPageIndex(pageIndex + 1)}
        >
          <Icon name="chevron" size={15} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}
