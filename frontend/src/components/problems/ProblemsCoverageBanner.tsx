/**
 * Banner de cobertura HONESTO: nunca afirma que o histórico está completo.
 * O texto descreve exatamente o que a sincronização atual cobre.
 */
export const PROBLEMS_COVERAGE_TEXT =
  "Cobertura inicial: últimos 60 dias e todos os problemas atualmente abertos. O histórico encerrado anterior a esse período ainda não foi processado.";

export function ProblemsCoverageBanner() {
  return (
    <div
      role="note"
      aria-label="Cobertura dos dados"
      className="rounded-md border border-border-subtle bg-surface px-4 py-3 text-sm text-foreground/70"
    >
      {PROBLEMS_COVERAGE_TEXT}
    </div>
  );
}
