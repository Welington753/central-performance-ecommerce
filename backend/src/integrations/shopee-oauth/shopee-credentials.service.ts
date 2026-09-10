import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { loadShopeeConfig, ShopeeConfig } from './shopee-config';
import { validateShopeeRedirectUri } from './shopee-redirect-uri.validator';

/**
 * Ponto único de acesso às credenciais estáticas da Shopee (Checkpoint
 * CP2A). Nunca loga `partnerKey`/`partnerId`, nunca os inclui em mensagem
 * de erro — somente os códigos fechados `SHOPEE_NOT_CONFIGURED`/
 * `INVALID_REDIRECT_URI`.
 *
 * A ausência de `SHOPEE_PARTNER_ID`/`SHOPEE_PARTNER_KEY`/
 * `SHOPEE_REDIRECT_URI` NUNCA impede o backend de subir: a validação só
 * ocorre quando `ensureConfigured()` é chamado por uma operação Shopee
 * real (nenhuma existe ainda neste checkpoint — sem controller, sem
 * cliente HTTP).
 */
@Injectable()
export class ShopeeCredentialsService {
  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return loadShopeeConfig(this.configService).configured;
  }

  ensureConfigured(): ShopeeConfig {
    const result = loadShopeeConfig(this.configService);
    if (!result.configured) {
      throw new ConflictException('SHOPEE_NOT_CONFIGURED');
    }

    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    if (!validateShopeeRedirectUri(result.config.redirectUri, nodeEnv)) {
      throw new ConflictException('INVALID_REDIRECT_URI');
    }

    return result.config;
  }
}
