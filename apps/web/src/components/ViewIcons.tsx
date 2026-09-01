'use client';
/**
 * The little view-switch glyphs, shared by every surface that offers a grid
 * and a list of the same thing. Emoji at 15px read as noise; two rects and
 * three bars say "tiles" and "rows" unmistakably.
 */
export function GridIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden>
      <rect x="0" y="0" width="7" height="7" rx="1.6" />
      <rect x="9" y="0" width="7" height="7" rx="1.6" />
      <rect x="0" y="9" width="7" height="7" rx="1.6" />
      <rect x="9" y="9" width="7" height="7" rx="1.6" />
    </svg>
  );
}

export function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden>
      <rect x="0" y="1" width="16" height="3" rx="1.5" />
      <rect x="0" y="6.5" width="16" height="3" rx="1.5" />
      <rect x="0" y="12" width="16" height="3" rx="1.5" />
    </svg>
  );
}
