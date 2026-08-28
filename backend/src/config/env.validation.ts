import Joi from 'joi';
import { validateMercadoLivreRedirectUri } from './mercado-livre-redirect-uri.validator';

/**
 * Esquema de validação das variáveis de ambiente da aplicação.
 *
 * A aplicação deve falhar ao subir (erro síncrono no boot do ConfigModule)
 * caso alguma variável obrigatória esteja ausente ou em formato inválido.
 *
 * Nenhuma credencial de marketplace é validada aqui: nesta fase não existem
 * integrações externas reais, apenas a fundação (contratos e stubs).
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  PORT: Joi.number().port().default(3000),

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
      const nodeEnv = (helpers.state.ancestors[0] as { NODE_ENV?: string })
        .NODE_ENV as string;
      if (!validateMercadoLivreRedirectUri(value, nodeEnv ?? 'development')) {
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
      const ancestors = helpers.state.ancestors[0] as {
        ML_HTTP_TIMEOUT_MS?: number;
        ML_ACCOUNT_LOCK_WAIT_MS?: number;
      };
      const timeout = ancestors.ML_HTTP_TIMEOUT_MS ?? 10000;
      const lockWait = ancestors.ML_ACCOUNT_LOCK_WAIT_MS ?? 3000;
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

  // Origem única do frontend, usada para CORS com credentials: true.
  FRONTEND_URL: Joi.string().uri().required(),

  // Controla a flag "Secure" dos cookies HttpOnly emitidos pela API.
  COOKIE_SECURE: Joi.string().valid('true', 'false').required(),

  // Liga/desliga o Swagger explicitamente. Se ausente, o padrão é
  // "habilitado somente fora de produção" (ver main.ts).
  ENABLE_SWAGGER: Joi.string().valid('true', 'false').optional(),

  // Rate limit padrão global (ThrottlerModule). A rota de login usa um
  // limite mais restrito, sobrescrito diretamente no controller (~5/60s)
  // via decorator @Throttle, conforme exigido para essa rota específica.
  THROTTLE_TTL_MS: Joi.number().integer().min(1000).default(60000),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(100),
}).unknown(true);
