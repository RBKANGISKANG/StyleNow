'use client';
/** Favourite heart: black outline with white fill until selected, then solid red. */
export function Heart({ on, size = 18 }: { on: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={on ? '#e0245e' : '#ffffff'}
      stroke={on ? '#e0245e' : '#2b2233'}
      strokeWidth={2.2}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M12 21s-6.7-4.3-9.3-8.1C.8 10 1.3 6.6 3.9 5c2.2-1.4 5-.7 6.6 1.2L12 7.8l1.5-1.6C15.1 4.3 17.9 3.6 20.1 5c2.6 1.6 3.1 5 1.2 7.9C18.7 16.7 12 21 12 21z" />
    </svg>
  );
}
