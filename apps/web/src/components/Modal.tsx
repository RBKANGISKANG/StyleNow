'use client';
/**
 * The dialog shell every operator popup shares.
 *
 * Appointment details, moving one, adding one — these are all "look at this
 * without losing your place in the calendar", which is exactly what a modal is
 * for. Panels that pushed the calendar down the page made you scroll back to
 * find the slot you were looking at.
 *
 * Escape and the backdrop close it, the page behind cannot scroll, and focus
 * moves into the dialog so a keyboard is not stranded at the top of the page.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** for content that needs room — the move picker's slot grid */
  wide?: boolean;
}) {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cardRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="cd-backdrop" onClick={onClose}>
      <div
        className={`md-card ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="md-card-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="btn btn-ghost sm" onClick={onClose} aria-label={t('f_close')}>
            ✕
          </button>
        </div>
        <div className="md-card-body">{children}</div>
        {footer && <div className="md-card-foot">{footer}</div>}
      </div>
    </div>
  );
}
