export function Notice({
  tone,
  children,
  onRetry,
}: {
  tone: "error" | "info" | "warn";
  children: React.ReactNode;
  onRetry?: () => void;
}) {
  const classes = {
    error: "border-negative/40 bg-negative/10 text-negative",
    warn: "border-notice/40 bg-notice/10 text-notice",
    info: "border-border-subtle bg-surface text-foreground/70",
  }[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-2.5 text-sm ${classes}`}
    >
      <span>{children}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="rounded-md border border-current px-3 py-1">
          Tentar novamente
        </button>
      ) : null}
    </div>
  );
}

/** Bloco cinza pulsante — placeholder de cards/gráficos enquanto carrega. */
export function Skeleton({ className = "h-24" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-xl bg-foreground/10 ${className}`} />;
}

export function TabSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Skeleton />
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
      <Skeleton className="h-56" />
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-xl border border-border-subtle bg-surface px-4 py-8 text-center text-sm text-foreground/70"
    >
      {children}
    </div>
  );
}
