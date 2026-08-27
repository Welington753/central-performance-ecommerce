export function EmptyStateIcon() {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className="h-10 w-10 text-foreground/30"
    >
      <rect
        x="6"
        y="10"
        width="36"
        height="28"
        rx="4"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M6 18h36"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M16 27h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="1 5"
      />
    </svg>
  );
}
