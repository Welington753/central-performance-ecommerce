import Joi from 'joi';

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
