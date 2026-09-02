export const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PeriodWindow {
  from: Date;
  to: Date;
}

/**
 * Janela de 60 dias usada na PRIMEIRA sincronização (design da Fase 3):
 * termina no instante de referência (UTC, internamente sempre correto
 * independente do fuso do processo Node) e cobre exatamente os 60 dias
 * anteriores. `America/Sao_Paulo` não observa horário de verão desde 2019 —
 * um dia tem sempre 24h em qualquer fuso relevante aqui, então a subtração
 * de duração em UTC já produz o resultado correto sem precisar de biblioteca
 * de fuso horário. O fuso só importa para EXIBIÇÃO (frontend), nunca para
 * este cálculo.
 */
export function computeInitialSyncWindow(referenceNow: Date): PeriodWindow {
  return rollingWindow(referenceNow, 60);
}

export interface KpiWindows {
  current: PeriodWindow;
  previous: PeriodWindow;
}

/**
 * Período atual: últimos 30 dias terminando agora. Comparação: os 30 dias
 * imediatamente anteriores — contíguo, sem sobreposição nem lacuna (o fim do
 * período anterior é exatamente o início do período atual).
 */
export function computeKpiWindows(referenceNow: Date): KpiWindows {
  const current = rollingWindow(referenceNow, 30);
  const previous: PeriodWindow = {
    from: new Date(current.from.getTime() - 30 * DAY_MS),
    to: current.from,
  };
  return { current, previous };
}

function rollingWindow(referenceNow: Date, days: number): PeriodWindow {
  return {
    from: new Date(referenceNow.getTime() - days * DAY_MS),
    to: referenceNow,
  };
}
