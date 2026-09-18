/**
 * Inline SVG rather than an image file: no network fetch, scales cleanly, and
 * inherits the theme's colours in both light and dark.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect
        x="1"
        y="1"
        width="46"
        height="46"
        rx="13"
        fill="var(--surface)"
        stroke="var(--border)"
        strokeWidth="1.5"
      />
      <path
        d="M12 31.5 L20 23 L26 28 L36 16"
        stroke="var(--chart-1)"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="36" cy="16" r="3.25" fill="var(--chart-3)" />
    </svg>
  );
}
