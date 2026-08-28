/**
 * Bloqueia qualquer chamada de rede real não mockada durante TODA a suíte
 * (design §9: "nenhum teste chegue a tocar a rede de verdade"). Rede de
 * segurança GERAL, independente de `MercadoLivreHttpClient`/`ML_FETCH` —
 * qualquer código que chame `fetch`/`global.fetch` diretamente sem mockar
 * cai aqui e falha alto, em vez de silenciosamente tentar uma chamada real.
 *
 * Carregado via `setupFiles` (NÃO `setupFilesAfterEnv`): `setupFiles` roda
 * antes da importação de qualquer arquivo de teste/produção daquele worker,
 * então nenhum módulo — incluindo `MercadoLivreOAuthModule` (Task 22), cujo
 * provider real usa `{ provide: ML_FETCH, useValue: fetch }` — consegue
 * capturar uma referência ao `fetch` real em tempo de import.
 *
 * O bloqueio é instalado UMA ÚNICA VEZ, no escopo do módulo, e NUNCA
 * restaurado (sem `afterEach`/`beforeEach`): um `afterEach` que devolvesse o
 * `fetch` real abriria uma janela real entre testes na qual uma chamada não
 * mockada teria sucesso de verdade. Todo teste que precisa da fronteira
 * HTTP usa exclusivamente seu próprio `ML_FETCH` injetado — nunca
 * `global.fetch` diretamente.
 */
global.fetch = (() => {
  throw new Error(
    'Chamada de rede real bloqueada nos testes — mocke a fronteira HTTP (ex.: forneça um `ML_FETCH` fake ao instanciar MercadoLivreHttpClient).',
  );
}) as typeof fetch;
