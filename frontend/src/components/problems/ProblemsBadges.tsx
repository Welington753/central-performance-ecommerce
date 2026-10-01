export type BadgeTone = "positive" | "negative" | "notice" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  positive: "border-positive/40 bg-positive/10 text-positive",
  negative: "border-negative/40 bg-negative/10 text-negative",
  notice: "border-notice/40 bg-notice/10 text-notice",
  neutral: "border-border-subtle text-foreground/70",
};

/**
 * Chip com TEXTO + símbolo geométrico: o significado nunca depende só da cor.
 * O símbolo é decorativo (aria-hidden) — o texto já diz tudo.
 */
export function Badge({
  tone,
  symbol,
  children,
}: {
  tone: BadgeTone;
  symbol: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      <span aria-hidden="true">{symbol}</span>
      {children}
    </span>
  );
}
