import Joi from 'joi';
import { validateAppHost } from './app-host.validator';
import { validateMercadoLivreRedirectUri } from './mercado-livre-redirect-uri.validator';

/**
 * `helpers.state.ancestors` do Joi não é tipado (é `any` na definição do
 * pacote) — este helper isola o `unknown` na fronteira e devolve um objeto
 * seguro para leitura de campos irmãos dentro de um `.custom()`.
 */
function readSiblingRecord(ancestors: unknown): Record<string, unknown> {
  const parent = Array.isArray(ancestors)
    ? (ancestors as unknown[])[0]
    : undefined;
  return typeof parent === 'object' && parent !== null
    ? (parent as Record<string, unknown>)
    : {};
}

function readStringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

/**
 * Esquema de validação das variáveis de ambiente da aplicação.
 *
 * A aplicação deve falhar ao subir (erro síncrono no boot do ConfigModule)
 * caso alguma variável obrigatória esteja ausente ou em formato inválido.
 *
 * As credenciais e configurações OAuth do Mercado Livre (`ML_*`) já são
 * validadas aqui, incluindo a regra de negócio do `ML_REDIRECT_URI` e a
 * margem de segurança de `ML_OAUTH_PROCESSING_STALE_AFTER_MS`.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  PORT: Joi.number().port().default(3000),

  // Interface de rede em que o servidor escuta — hostname/IP puro, nunca
  // URL nem `host:porta` (a porta é `PORT`, acima). Sem valor padrão fixo
  // aqui: `main.ts` usa `127.0.0.1` como fallback só fora de produção,
  // preservando a possibilidade de escutar em `0.0.0.0` dentro de um
  // container de produção sem exigir a variável.
  APP_HOST: Joi.string()
    .custom((value: string, helpers) => {
      if (!validateAppHost(value)) return helpers.error('any.invalid');
      return value;
    }, 'APP_HOST hostname/IP validation')
    .optional(),

  // String de conexão do Postgres (local ou hospedado). Sem Docker nesta fase.
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),

  // Segredo do JWT de access token (curta duração). Sem valor padrão.
  ACCESS_TOKEN_SECRET: Joi.string().min(32).required(),
  // Duração do access token em segundos (padrão: 900s = 15 minutos).
  ACCESS_TOKEN_TTL_SECONDS: Joi.number().integer().min(60).default(900),

  // Duração dos refresh tokens (dias) antes de expirarem.
  REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).default(30),

  // Chave AES-256-GCM (32 bytes) para o EncryptionService genérico.
  // Aceita hex (64 caracteres) ou base64. Sem valor padrão: nunca deve ter fallback inseguro.
  CREDENTIAL_ENCRYPTION_KEY: Joi.string().required(),

  // --- Mercado Livre OAuth (Fase 2) --------------------------------------
  // Segredos da aplicação ML cadastrada no DevCenter. Sem valor padrão.
  ML_CLIENT_ID: Joi.string().required(),
  ML_CLIENT_SECRET: Joi.string().required(),
  // Validado também pela regra de negócio (HTTPS em produção, sem
  // query/fragmento) em `mercado-livre-redirect-uri.validator.ts`.
  ML_REDIRECT_URI: Joi.string()
    .uri()
    .required()
    .custom((value: string, helpers) => {
      const siblings = readSiblingRecord(helpers.state.ancestors);
      const nodeEnv = readStringField(siblings, 'NODE_ENV') ?? 'development';
      if (!validateMercadoLivreRedirectUri(value, nodeEnv)) {
        return helpers.error('any.invalid');
      }
      return value;
    }, 'ML_REDIRECT_URI business rule'),

  ML_HTTP_TIMEOUT_MS: Joi.number().integer().min(1).default(10000),
  ML_ACCOUNT_LOCK_WAIT_MS: Joi.number().integer().min(1).default(3000),
  ML_OAUTH_PROCESSING_STALE_AFTER_MS: Joi.number()
    .integer()
    .min(1)
    .default(120000)
    .custom((value: number, helpers) => {
      const siblings = readSiblingRecord(helpers.state.ancestors);
      const timeout = readNumberField(siblings, 'ML_HTTP_TIMEOUT_MS') ?? 10000;
      const lockWait =
        readNumberField(siblings, 'ML_ACCOUNT_LOCK_WAIT_MS') ?? 3000;
      const explicitSafetyMarginMs = 5000;
      // Duração combinada plausível do pior caso do callback: espera pelo
      // advisory lock + troca de code + /users/me, as duas últimas limitadas
      // por ML_HTTP_TIMEOUT_MS cada — design §5.
      const worstCasePlausibleDurationMs =
        lockWait + 2 * timeout + explicitSafetyMarginMs;
      if (value <= worstCasePlausibleDurationMs) {
        return helpers.error('any.invalid');
      }
      return value;
    }, 'ML_OAUTH_PROCESSING_STALE_AFTER_MS safety margin'),
  ML_TOKEN_REFRESH_LEEWAY_MS: Joi.number().integer().min(1).default(900000),

  // --- Amazon SP-API (Fase 4, fundação de autenticação) ------------------
  // Nenhuma tem `.required()` nem valor padrão: a ausência de qualquer uma
  // delas NUNCA pode impedir o backend de subir. Só uma operação Amazon
  // específica (AmazonAuthService.ensureValidAccessToken) falha, em
  // runtime, com o erro fechado AMAZON_NOT_CONFIGURED (ver amazon-config.ts
  // em integrations/amazon-sp-api/).
  AMAZON_SP_API_APP_ID: Joi.string().optional(),
  AMAZON_LWA_CLIENT_ID: Joi.string().optional(),
  AMAZON_LWA_CLIENT_SECRET: Joi.string().optional(),
  AMAZON_SP_API_ENDPOINT: Joi.string().uri().optional(),
  AMAZON_SP_API_USER_AGENT: Joi.string().optional(),
  // Lista separada por vírgulas dos marketplaceIds Amazon aceitos
  // (Checkpoint 4-B) — nunca hardcoded no código, nunca um valor real neste
  // schema. Sem valor padrão: também opcional, mesma regra de boot acima.
  AMAZON_MARKETPLACE_IDS: Joi.string().optional(),

  // Origem única do frontend, usada para CORS com credentials: true.
  FRONTEND_URL: Joi.string().uri().required(),

  // Controla a flag "Secure" dos cookies HttpOnly emitidos pela API.
  COOKIE_SECURE: Joi.string().valid('true', 'false').required(),

  // Liga/desliga o Swagger explicitamente. Se ausente, o padrão é
  // "habilitado somente fora de produção" (ver main.ts).
  ENABLE_SWAGGER: Joi.string().valid('true', 'false').optional(),

  // --- Sincronização automática multi-marketplace (Fase 4) ---------------
  // Desligada por padrão: um deploy existente nunca começa a chamar
  // marketplaces reais em ciclo sozinho sem decisão explícita. SEMPRE
  // desligada quando NODE_ENV=test, independente deste valor (ver
  // MarketplaceAutoSyncService.onModuleInit).
  MARKETPLACE_AUTO_SYNC_ENABLED: Joi.string()
    .valid('true', 'false')
    .default('false'),
  // Intervalo entre ciclos, em minutos. Padrão recomendado: 60.
  MARKETPLACE_AUTO_SYNC_INTERVAL_MINUTES: Joi.number()
    .integer()
    .min(1)
    .default(60),

  // Rate limit padrão global (ThrottlerModule). A rota de login usa um
  // limite mais restrito, sobrescrito diretamente no controller (~5/60s)
  // via decorator @Throttle, conforme exigido para essa rota específica.
  THROTTLE_TTL_MS: Joi.number().integer().min(1000).default(60000),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(100),
}).unknown(true);
