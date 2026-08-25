'use client';
/**
 * One confirmation dialog for every destructive action in the product.
 *
 * Three levels of friction, picked per action:
 *  - plain: title + consequences + a red button (removing a price rule)
 *  - typeToConfirm: the operator has to type the exact name back (deleting a
 *    branch, closing a company) — a mis-click cannot get through it
 *  - questions: an exit questionnaire that must be answered before the button
 *    unlocks (deleting an account, closing a company). We ask *before* the
 *    deletion, because afterwards there is nobody left to ask.
 *
 * Nothing here deletes anything itself — it hands `onConfirm` the answers and
 * lets the caller do the work.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';

export interface ConfirmQuestion {
  id: string;
  label: string;
  /** radio options; omit for a free-text answer */
  options?: string[];
  /** an unanswered required question keeps the confirm button disabled */
  required?: boolean;
  placeholder?: string;
}

export type ConfirmAnswers = Record<string, string>;

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** short sentence: what is about to happen */
  body?: string;
  /** bullet list: exactly what is lost and what is kept */
  consequences?: string[];
  /** when set, the exact string the person must type to unlock the button */
  typeToConfirm?: string;
  questions?: ConfirmQuestion[];
  /** label of the destructive button */
  confirmLabel: string;
  /** rendered above the buttons, e.g. "Download my data first" */
  extra?: React.ReactNode;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (answers: ConfirmAnswers) => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  consequences,
  typeToConfirm,
  questions,
  confirmLabel,
  extra,
  busy,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const [typed, setTyped] = useState('');
  const [answers, setAnswers] = useState<ConfirmAnswers>({});

  // Every opening starts from a blank slate — never inherit the last answer.
  useEffect(() => {
    if (open) {
      setTyped('');
      setAnswers({});
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const unlocked = useMemo(() => {
    if (typeToConfirm && typed.trim().toLowerCase() !== typeToConfirm.trim().toLowerCase()) return false;
    for (const q of questions ?? []) {
      if (q.required && !(answers[q.id] ?? '').trim()) return false;
    }
    return true;
  }, [typeToConfirm, typed, questions, answers]);

  if (!open) return null;

  return (
    <div className="cd-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}>
      <div className="cd-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="cd-title">⚠️ {title}</h3>
        {body && <p className="cd-body">{body}</p>}

        {consequences && consequences.length > 0 && (
          <ul className="cd-list">
            {consequences.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        )}

        {questions?.map((q) => (
          <div key={q.id} className="cd-q">
            <span className="cd-q-label">
              {q.label}
              {q.required && <em> *</em>}
            </span>
            {q.options ? (
              <div className="cd-opts">
                {q.options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    className={answers[q.id] === o ? 'on' : ''}
                    onClick={() => setAnswers((a) => ({ ...a, [q.id]: o }))}
                  >
                    {o}
                  </button>
                ))}
              </div>
            ) : (
              <input
                className="input"
                placeholder={q.placeholder ?? ''}
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              />
            )}
          </div>
        ))}

        {typeToConfirm && (
          <label className="cd-type">
            <span>{t('cd_type_prompt', { word: typeToConfirm })}</span>
            <input
              className="input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={typeToConfirm}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}

        {extra && <div className="cd-extra">{extra}</div>}

        <div className="cd-actions">
          <button className="btn btn-soft" onClick={onCancel} disabled={busy}>
            {t('cd_keep')}
          </button>
          <button
            className="btn cd-danger"
            disabled={!unlocked || busy}
            onClick={() => onConfirm(answers)}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** What a caller passes to `ask()` — the dialog props minus the plumbing. */
export type ConfirmRequest = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'onConfirm' | 'busy'> & {
  /** performed once the person confirms; awaited, so the button can show busy */
  run: (answers: ConfirmAnswers) => void | Promise<void>;
};

/**
 * Drop-in confirmation for a component with several destructive buttons:
 *
 *   const { ask, dialog } = useConfirm();
 *   <button onClick={() => ask({ title: …, confirmLabel: …, run: () => deleteIt() })}>
 *   {dialog}
 */
export function useConfirm(): { ask: (req: ConfirmRequest) => void; dialog: React.ReactNode } {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = useCallback((next: ConfirmRequest) => {
    setBusy(false);
    setReq(next);
  }, []);

  const close = useCallback(() => {
    setBusy(false);
    setReq(null);
  }, []);

  const dialog = req ? (
    <ConfirmDialog
      {...req}
      open
      busy={busy}
      onCancel={close}
      onConfirm={(answers) => {
        setBusy(true);
        void Promise.resolve(req.run(answers)).then(close, close);
      }}
    />
  ) : null;

  return { ask, dialog };
}
