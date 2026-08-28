'use client';
/**
 * The drawn icon set.
 *
 * The app has always used emoji as icons — ⚡ 🕐 📍 🗣 ⭐ 🔄. They render as a
 * different picture on every platform, cannot take a brand colour, and read as
 * a placeholder somebody forgot to replace. These are stroke paths on a 24px
 * grid at 1.8, so they scale, recolour with `currentColor`, and look like one
 * family.
 *
 * `<Glyph>` is the migration seam: it keeps the emoji in classic and draws the
 * icon in studio, so a caller does not have to branch.
 */
import { useStudio } from '@/lib/design';

export type IconName =
  | 'scissors' | 'star' | 'pin' | 'clock' | 'calendar' | 'zap' | 'bell' | 'heart'
  | 'share' | 'trend' | 'users' | 'message' | 'shield' | 'repeat' | 'phone'
  | 'search' | 'plus' | 'check' | 'chevron' | 'sparkle' | 'globe' | 'briefcase'
  | 'user' | 'image' | 'sun';

const STROKE: Partial<Record<IconName, string>> = {
  scissors: 'M6 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M6 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M20 4L8.5 15.5 M20 20L8.5 8.5',
  pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z M12 10m-2.6 0a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0',
  clock: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 7v5l3.5 2',
  calendar: 'M5.5 5h13A2.5 2.5 0 0 1 21 7.5v11A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5v-11A2.5 2.5 0 0 1 5.5 5z M3 10h18 M8 3v4 M16 3v4',
  zap: 'M13 2L4.5 13.5H11l-1 8.5L19.5 10H13z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8 M13.7 21a2 2 0 0 1-3.4 0',
  heart: 'M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 7a4 4 0 0 1 7 3.5C19 15.5 12 20 12 20z',
  share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7 M12 15V3 M8 7l4-4 4 4',
  trend: 'M3 17l6-6 4 4 8-8 M15 7h6v6',
  users: 'M17 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9.5 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M22 20v-2a4 4 0 0 0-3-3.9',
  message: 'M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  shield: 'M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6z M9 12l2 2 4-4',
  repeat: 'M3 12a9 9 0 0 1 15-6.7L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-15 6.7L3 16 M3 21v-5h5',
  phone: 'M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2.2 2A17 17 0 0 1 3 6.2 2 2 0 0 1 5 4z',
  search: 'M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0 M20 20l-3.5-3.5',
  plus: 'M12 5v14 M5 12h14',
  check: 'M5 13l4 4L19 7',
  chevron: 'M9 6l6 6-6 6',
  globe: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M3 12h18 M12 3a15 15 0 0 1 0 18 M12 3a15 15 0 0 0 0 18',
  briefcase: 'M5.5 6h13A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-9A2.5 2.5 0 0 1 5.5 6z M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6',
  user: 'M12 8m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
  image: 'M5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9A2.5 2.5 0 0 1 5.5 5z M9 10.5m-1.8 0a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0 M21 16l-5.5-5.5L7 19',
  sun: 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
};

/** Solid marks — a star outline reads as "not rated yet", which is a different thing. */
const FILLED: Partial<Record<IconName, string>> = {
  star: 'M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.45l-5.81 3.05 1.11-6.47-4.7-4.58 6.5-.95z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
};

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const filled = FILLED[name];
  const common = { width: size, height: size, viewBox: '0 0 24 24', className, style, 'aria-hidden': true } as const;

  if (filled) {
    return (
      <svg {...common} fill="currentColor">
        <path d={filled} />
      </svg>
    );
  }
  return (
    <svg
      {...common}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={STROKE[name] ?? STROKE.clock!} />
    </svg>
  );
}

/**
 * An emoji in classic, a drawn icon in studio. Every call site that used to
 * hardcode a glyph goes through here, so the two treatments stay in step.
 */
export function Glyph({
  name,
  emoji,
  size = 18,
  style,
}: {
  name: IconName;
  emoji: string;
  size?: number;
  style?: React.CSSProperties;
}) {
  const studio = useStudio();
  if (!studio) return <span style={style}>{emoji}</span>;
  return <Icon name={name} size={size} style={{ verticalAlign: '-0.16em', ...style }} />;
}
