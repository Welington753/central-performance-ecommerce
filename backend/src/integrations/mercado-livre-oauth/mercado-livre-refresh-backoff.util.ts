// Backoff exponencial com jitter (0-50% adicional) para falhas RECUPERÁVEIS
// de renovação de token (correção de resiliência OAuth). Base de 30s (bem
// maior que o backoff de páginas HTTP em `amazon-backoff.util.ts`, 500ms):
// uma renovação de token é de baixa frequência/alto custo de bater
// repetidamente num provedor fora do ar, e o job de renovação já roda a
// cada 5 minutos — um piso de 30s evita qualquer chance de looping
// perceptível dentro do mesmo ciclo, sem inventar coordenação nova.
// Duplicado deliberadamente (não extraído para um util compartilhado com
// `amazon-backoff.util.ts`) para nunca tocar o módulo Amazon nesta correção.
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 30 * 60 * 1000;

export function computeRefreshBackoffDelayMs(
  failureCount: number,
  randomFn: () => number = Math.random,
): number {
  const exponential = Math.min(
    BASE_DELAY_MS * 2 ** Math.max(failureCount - 1, 0),
    MAX_DELAY_MS,
  );
  const jitter = exponential * 0.5 * randomFn();
  return Math.round(exponential + jitter);
}
