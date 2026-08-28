'use client';
/**
 * Messages tab — the salon's inbox.
 *
 * Before this, a shop could reach a customer only by ringing the number on the
 * booking, and a customer could reach the shop only during opening hours. Both
 * work for "I'm ten minutes late" and neither works for "could you do Saturday
 * instead?" — which is the question that otherwise turns into a cancellation.
 *
 * The list shows every customer, not only the ones who have written, because
 * the shop's most valuable message is usually the first one and an inbox of
 * existing conversations makes starting one impossible. Search narrows, unread
 * floats to the top, and the thread opens beside the list on a desktop and over
 * it on a phone.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { timeOf, dateOf } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { MessageThread } from '@/components/MessageThread';
import { usePaged, Pager } from '@/components/Pager';
import { apiShopThreads, useMessagesChanged, type ThreadSummary } from '@/lib/api';
import { OperatorShell } from '../shell';
import type { ShopRef } from '@/lib/owned-shops';

export function MessagesScreen({ shops }: { shops: ShopRef[] }) {
  return (
    <OperatorShell shops={shops} active="/dashboard/messages">
      {({ shopId }) => (
        <Suspense fallback={<div className="spinner" />}>
          <MessagesTab shopId={shopId} />
        </Suspense>
      )}
    </OperatorShell>
  );
}

function MessagesTab({ shopId }: { shopId: string }) {
  const { t, lang } = useI18n();
  // ?customer=<key> lands straight in one conversation — how the Customers
  // tab's message button gets here.
  const wanted = useSearchParams().get('customer');
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [open, setOpen] = useState<string | null>(wanted);
  const [q, setQ] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  // A response that started before a change must never overwrite one that
  // started after it — two reads of the same list can resolve out of order.
  const seq = useRef(0);
  const load = useCallback(() => {
    const mine = ++seq.current;
    void apiShopThreads(shopId).then((rows) => {
      if (mine === seq.current) setThreads(rows);
    });
  }, [shopId]);

  useEffect(load, [load]);
  useMessagesChanged(load);
  // The deep link wins on arrival. The shell resolves shopId a beat after
  // mount ('' → the real id), so resetting on every change would wipe the
  // link before the list ever loads — only a switch between two real shops
  // closes the open thread.
  const prevShop = useRef(shopId);
  useEffect(() => {
    if (prevShop.current && shopId && prevShop.current !== shopId) setOpen(null);
    prevShop.current = shopId;
  }, [shopId]);

  const filtered = useMemo(() => {
    const rows = threads ?? [];
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (unreadOnly && r.unread === 0) return false;
      if (!needle) return true;
      return `${r.customerName} ${r.customerPhone} ${r.lastMessage?.text ?? ''}`.toLowerCase().includes(needle);
    });
  }, [threads, q, unreadOnly]);

  const paged = usePaged(filtered, 15, `${q}|${unreadOnly}`);
  const chosen = (threads ?? []).find((r) => r.customerKey === open) ?? null;
  const totalUnread = (threads ?? []).reduce((n, r) => n + r.unread, 0);

  if (threads === null) return <div className="spinner" />;

  return (
    <section className="section">
      <div className="sec-head">
        <h2>{t('tab_messages')}</h2>
        <span className="sec-note">
          {totalUnread > 0
            ? t(totalUnread === 1 ? 'mg_unread_one' : 'mg_unread_n', { n: String(totalUnread) })
            : t('mg_all_read')}
        </span>
      </div>

      <div className={`inbox${chosen ? ' open' : ''}`}>
        <div className="inbox-list">
          <div className="inbox-tools">
            <input
              className="inbox-search"
              placeholder={t('mg_search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className={`chip ${unreadOnly ? 'on-primary' : ''}`} onClick={() => setUnreadOnly(!unreadOnly)}>
              {t('mg_unread_only')}
            </button>
          </div>

          {filtered.length === 0 ? (
            <p className="thread-empty">{t('mg_no_rows')}</p>
          ) : (
            <>
              <ul className="inbox-rows">
                {paged.page.map((r) => (
                  <li key={r.customerKey}>
                    <button
                      className={`inbox-row${open === r.customerKey ? ' on' : ''}${r.unread ? ' unread' : ''}`}
                      onClick={() => setOpen(r.customerKey)}
                    >
                      <span className="inbox-name">
                        {r.customerName}
                        {r.unread > 0 && <em className="inbox-dot">{r.unread}</em>}
                      </span>
                      <span className="inbox-last">
                        {r.lastMessage
                          ? `${r.lastMessage.from === 'shop' ? `${t('mg_you')}: ` : ''}${r.lastMessage.text}`
                          : r.nextVisit
                            ? t('mg_books_on', { when: dateOf(r.nextVisit, lang) })
                            : t('mg_never')}
                      </span>
                      {r.lastMessage && <span className="inbox-when">{timeOf(r.lastMessage.at, lang)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              <Pager paged={paged} perPage={15} />
            </>
          )}
        </div>

        <div className="inbox-thread">
          {chosen ? (
            <MessageThread
              shopId={shopId}
              customerKey={chosen.customerKey}
              me="shop"
              title={chosen.customerName}
              subtitle={
                chosen.nextVisit
                  ? t('mg_books_on', { when: dateOf(chosen.nextVisit, lang) })
                  : chosen.customerPhone || undefined
              }
              phone={chosen.customerPhone || undefined}
              onSent={load}
              onBack={() => setOpen(null)}
            />
          ) : (
            <div className="inbox-none">
              <Icon name="message" size={26} strokeWidth={1.8} />
              <p>{t('mg_pick')}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
