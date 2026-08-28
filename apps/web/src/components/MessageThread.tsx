'use client';
/**
 * One conversation, from either side.
 *
 * The same component serves the salon and the customer — the only difference is
 * which side counts as "me", so that is the only prop that changes. Two
 * separate chat screens would have drifted apart within a week.
 *
 * Messages poll rather than stream. There is no socket in this stack and
 * inventing one for a demo would be dishonest about what is running; a short
 * interval while the thread is open is enough for a conversation that moves at
 * the speed of a receptionist, and it stops the moment the tab is hidden.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n, type MsgKey } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { apiThread, apiSendMessage, apiMarkThreadRead } from '@/lib/api';
import type { Message } from '@/core/store';

const POLL_MS = 4000;

export function MessageThread({
  shopId,
  customerKey,
  me,
  title,
  subtitle,
  phone,
  onSent,
  onBack,
}: {
  shopId: string;
  customerKey: string;
  me: 'shop' | 'customer';
  title: string;
  subtitle?: string;
  phone?: string;
  onSent?: () => void;
  onBack?: () => void;
}) {
  const { t, lang } = useI18n();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);

  const load = useCallback(async () => {
    const rows = await apiThread(shopId, customerKey);
    setMessages(rows);
    // Reading is a side effect of looking at it, which is what people expect.
    if (rows.some((m) => m.from !== me && m.readAt === null)) {
      await apiMarkThreadRead(shopId, customerKey, me);
      onSent?.();
    }
  }, [shopId, customerKey, me, onSent]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  // Follow the conversation down, but never yank the view away from somebody
  // who has scrolled up to read something older.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !atBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft('');
    atBottom.current = true;
    await apiSendMessage(shopId, customerKey, me, text);
    await load();
    setSending(false);
    onSent?.();
  };

  return (
    <div className="thread">
      <header className="thread-head">
        {onBack && (
          <button className="thread-back" onClick={onBack} aria-label={t('mg_back')}>
            <Icon name="chevron" size={17} strokeWidth={2.4} style={{ transform: 'rotate(180deg)' }} />
          </button>
        )}
        <div className="thread-who">
          <strong>{title}</strong>
          {subtitle && <span>{subtitle}</span>}
        </div>
        {phone && (
          <a className="btn btn-soft sm" href={`tel:${phone.replace(/\s/g, '')}`}>
            <Icon name="phone" size={14} strokeWidth={2.2} />
            {t('mg_call')}
          </a>
        )}
      </header>

      <div
        className="thread-body"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {messages === null ? (
          <div className="spinner" />
        ) : messages.length === 0 ? (
          <p className="thread-empty">{me === 'shop' ? t('mg_empty_shop') : t('mg_empty_cus')}</p>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
            return (
              <div key={m.id}>
                {newDay && <div className="thread-day">{dayLabel(m.at, lang, t)}</div>}
                <div className={`bubble ${m.from === me ? 'mine' : 'theirs'}`}>
                  <p>{m.text}</p>
                  <span className="bubble-meta">
                    {new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
                      timeZone: 'Europe/Berlin',
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(m.at)}
                    {m.from === me && m.readAt !== null && ` · ${t('mg_read')}`}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="thread-compose">
        <textarea
          rows={1}
          value={draft}
          placeholder={t('mg_placeholder')}
          maxLength={1000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a new line — the convention everywhere
            // else people type short messages.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn btn-primary" disabled={!draft.trim() || sending} onClick={() => void send()}>
          {t('mg_send')}
        </button>
      </div>
    </div>
  );
}

function dayLabel(at: number, lang: 'en' | 'de', t: (k: MsgKey) => string): string {
  const midnight = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
  const days = Math.round((midnight(Date.now()) - midnight(at)) / 864e5);
  if (days === 0) return t('mg_today');
  if (days === 1) return t('mg_yesterday');
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(at));
}
