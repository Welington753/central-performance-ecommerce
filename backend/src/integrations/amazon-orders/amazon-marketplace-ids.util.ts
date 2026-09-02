import { ConfigService } from '@nestjs/config';

/**
 * Lê `AMAZON_MARKETPLACE_IDS` (lista separada por vírgulas, Checkpoint 4-B).
 * Nunca lança — ausência/valor vazio produz `null`, e é o CHAMADOR
 * (`AmazonOrdersSyncService`) quem decide se isso vira `AMAZON_NOT_CONFIGURED`.
 * Nenhum marketplace é hardcoded aqui — o escopo vem inteiramente da
 * configuração da própria conta.
 */
export function loadAmazonMarketplaceIds(
  configService: ConfigService,
): string[] | null {
  const raw = configService.get<string>('AMAZON_MARKETPLACE_IDS');
  if (!raw) return null;

  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  return ids.length > 0 ? ids : null;
}
