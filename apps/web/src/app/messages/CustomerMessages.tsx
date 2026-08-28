'use client';
/**
 * The customer's side of the conversation.
 *
 * One thread per salon they have booked with — no directory, no way to start a
 * conversation with a shop you have never been to. That is deliberate: an open
 * inbox on a marketplace is a spam channel, and the booking is what makes a
 * message expected on both sides.
 *
 * A shop can be preselected via ?shop=, which is how the button on a booking
 * card lands you straight in the right conversation.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { dateOf, timeOf } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { MessageThread } from '@/components/MessageThread';
import { apiMyThreads, useMessagesChanged, type ThreadSummary } from '@/lib/api';

export function CustomerMessages() {
  const { t, lang } = useI18n();
  const params = useSearchParams();
  const wanted = params.get('shop');
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const seq = useRef(0);
  const load = useCallback(() => {
    const mine = ++seq.current;
    void apiMyThreads().then((rows) => {
      if (mine !== seq.current) return;
      setThreads(rows);
      setOpen((current) => {
        if (current) return current;
        // Deep link first, then the one conversation that already exists;
        // on a phone, landing in a list you then have to tap through is a
        // wasted step when there is only one thing in it.
        const target = wanted ? rows.find((r) => r.shopId === wanted) : rows.length === 1 ? rows[0] : null;
        return target ? target.shopId : null;
      });
    });
  }, [wanted]);

  useEffect(load, [load]);
  useMessagesChanged(load);

  const chosen = (threads ?? []).find((r) => r.shopId === open) ?? null;

  return (
    <div>
      <div className="page-title">
        <h1>{t('mg_title')}</h1>
      </div>

      {threads === null ? (
        <div className="spinner" />
      ) : threads.length === 0 ? (
        <div className="empty">
          <div className="big">💬</div>
          <p>{t('mg_none_cus')}</p>
          <Link href="/" className="btn btn-primary" style={{ marginTop: 14 }}>
            {t('explore_now')}
          </Link>
        </div>
      ) : (
        <div className={`inbox${chosen ? ' open' : ''}`}>
          <div className="inbox-list">
            <ul className="inbox-rows">
              {threads.map((r) => (
                <li key={r.shopId}>
                  <button
                    className={`inbox-row${open === r.shopId ? ' on' : ''}${r.unread ? ' unread' : ''}`}
                    onClick={() => setOpen(r.shopId)}
                  >
                    <span className="inbox-name">
                      <span className="inbox-mark">{r.shopEmoji}</span>
                      {r.shopName}
                      {r.unread > 0 && <em className="inbox-dot">{r.unread}</em>}
                    </span>
                    <span className="inbox-last">
                      {r.lastMessage
                        ? `${r.lastMessage.from === 'customer' ? `${t('mg_you')}: ` : ''}${r.lastMessage.text}`
                        : r.nextVisit
                          ? t('mg_books_on', { when: dateOf(r.nextVisit, lang) })
                          : t('mg_never')}
                    </span>
                    {r.lastMessage && <span className="inbox-when">{timeOf(r.lastMessage.at, lang)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="inbox-thread">
            {chosen ? (
              <MessageThread
                shopId={chosen.shopId}
                customerKey={chosen.customerKey}
                me="customer"
                title={`${chosen.shopEmoji} ${chosen.shopName}`}
                subtitle={chosen.nextVisit ? t('mg_books_on', { when: dateOf(chosen.nextVisit, lang) }) : undefined}
                onSent={load}
                onBack={() => setOpen(null)}
              />
            ) : (
              <div className="inbox-none">
                <Icon name="message" size={26} strokeWidth={1.8} />
                <p>{t('mg_pick_shop')}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
