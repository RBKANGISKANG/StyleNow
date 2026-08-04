/**
 * StyleNow design tokens — the single source of truth for both web and mobile.
 * Web consumes them as CSS custom properties (see apps/web/src/app/globals.css,
 * which mirrors these values); mobile reads them directly.
 */
export const color = {
  bg: '#faf7f2',
  bgSoft: '#f1ece3',
  surface: '#ffffff',
  ink: '#1b1712',
  inkSoft: '#6f6458',
  line: 'rgba(27, 23, 18, 0.10)',
  accent: '#b4552d', // burnt copper — CTAs, active states
  accentSoft: '#f7e4d9',
  success: '#2e7d5b',
  warning: '#b07c1f',
  danger: '#b03030',
} as const;

export const font = {
  display: "'Playfair Display', Georgia, serif",
  body: "'Inter', -apple-system, 'Segoe UI', sans-serif",
} as const;

export const radius = { sm: 10, md: 14, lg: 20, pill: 999 } as const;

export const space = (n: number): number => n * 4;
