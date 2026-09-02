import { ConfigService } from '@nestjs/config';

/**
 * Configuração da aplicação privada Amazon SP-API, só existente quando as
 * cinco variáveis (Etapa 2) estão presentes. Client Secret é configuração da
 * aplicação (não de conta) — nunca é lido a partir de `MarketplaceAccount`.
 */
export interface AmazonConfig {
  appId: string;
  lwaClientId: string;
  lwaClientSecret: string;
  spApiEndpoint: string;
  userAgent: string;
}

export type AmazonConfigResult =
  { configured: true; config: AmazonConfig } | { configured: false };

/**
 * Nunca lança: a ausência de qualquer variável Amazon não pode impedir o
 * backend de subir (Etapa 2). Só o CHAMADOR (`AmazonAuthService`) decide se
 * `configured: false` deve virar o erro fechado `AMAZON_NOT_CONFIGURED`.
 * Validação de pertencimento à allowlist do endpoint é responsabilidade de
 * quem consome `spApiEndpoint` (o próprio client SP-API), não deste loader —
 * mantém os dois motivos de falha (ausência de config x endpoint fora da
 * allowlist) testáveis e reportáveis separadamente.
 */
export function loadAmazonConfig(
  configService: ConfigService,
): AmazonConfigResult {
  const appId = configService.get<string>('AMAZON_SP_API_APP_ID');
  const lwaClientId = configService.get<string>('AMAZON_LWA_CLIENT_ID');
  const lwaClientSecret = configService.get<string>('AMAZON_LWA_CLIENT_SECRET');
  const spApiEndpoint = configService.get<string>('AMAZON_SP_API_ENDPOINT');
  const userAgent = configService.get<string>('AMAZON_SP_API_USER_AGENT');

  if (
    !appId ||
    !lwaClientId ||
    !lwaClientSecret ||
    !spApiEndpoint ||
    !userAgent
  ) {
    return { configured: false };
  }

  return {
    configured: true,
    config: { appId, lwaClientId, lwaClientSecret, spApiEndpoint, userAgent },
  };
}
