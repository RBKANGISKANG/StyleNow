'use client';
/**
 * Category picker: a dropdown that shows every category as an icon tile
 * (a native <select> can't render images), with an inline "add your own"
 * field. Anything added here is shared — it shows up for every other company
 * that opens a picker afterwards.
 */
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { allCategories, categoryLabel, type CategoryDef } from '@/core/categories';
import { apiCustomCategories, apiAddCustomCategory } from '@/lib/api';

export function CategoryPicker({
  value,
  onChange,
  compact = false,
}: {
  value: string | null;
  onChange: (id: string) => void;
  compact?: boolean;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<Array<{ id: string; label: string }>>([]);
  const [newLabel, setNewLabel] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void apiCustomCategories().then(setCustom);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const cats: CategoryDef[] = allCategories(custom);
  const selected = cats.find((c) => c.id === value) ?? null;

  const addOwn = async () => {
    const label = newLabel.trim();
    if (!label) return;
    const cat = await apiAddCustomCategory(label);
    if (cat) {
      setCustom((cs) => (cs.some((c) => c.id === cat.id) ? cs : [...cs, cat]));
      onChange(cat.id);
      setNewLabel('');
      setOpen(false);
    }
  };

  return (
    <div className="cat-picker" ref={boxRef}>
      <button
        type="button"
        className={`cat-trigger ${compact ? 'compact' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="cat-trigger-ico">{selected ? selected.emoji : '🏷️'}</span>
        <span className="cat-trigger-label">{selected ? categoryLabel(selected, lang) : t('cat_choose')}</span>
        <span className="cat-caret">▾</span>
      </button>

      {open && (
        <div className="cat-menu" role="listbox">
          <div className="cat-grid">
            {cats.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={c.id === value}
                className={`cat-opt ${c.id === value ? 'sel' : ''}`}
                onClick={() => {
                  onChange(c.id);
                  setOpen(false);
                }}
              >
                <span className="cat-opt-ico">{c.emoji}</span>
                <span className="cat-opt-label">{categoryLabel(c, lang)}</span>
              </button>
            ))}
          </div>
          <div className="cat-add">
            <input
              className="input"
              placeholder={t('cat_own_ph')}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addOwn();
                }
              }}
              maxLength={40}
            />
            <button type="button" className="btn btn-primary sm" disabled={!newLabel.trim()} onClick={() => void addOwn()}>
              {t('p_cat_add')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Small read-only badge used in tables and on the shop page. */
export function CategoryBadge({ id, custom }: { id: string; custom: Array<{ id: string; label: string }> }) {
  const { lang } = useI18n();
  const cat = allCategories(custom).find((c) => c.id === id);
  if (!cat) return null;
  return (
    <span className="cat-badge">
      {cat.emoji} {categoryLabel(cat, lang)}
    </span>
  );
}
