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

  /**
   * Só Partner ID/Partner Key/ambiente presentes — NUNCA valida
   * `redirectUri` (revisão de segurança do Checkpoint CP2B). Uso
   * pretendido: qualquer operação que não constrói nem depende de uma URL
   * de callback, como o cliente de token (`ShopeeHttpClient`) — `code`/
   * `shop_id` chegam pelo callback, mas trocá-los por tokens não exige
   * revalidar a URL do próprio callback. Forçar essa dependência ali seria
   * artificial: a Shopee nunca envia nem espera `redirect_uri` no corpo de
   * `/auth/token/get`/`/auth/access_token/get`.
   */
  ensureCredentials(): ShopeeConfig {
    const result = loadShopeeConfig(this.configService);
    if (!result.configured) {
      throw new ConflictException('SHOPEE_NOT_CONFIGURED');
    }
    return result.config;
  }

  /**
   * Credenciais + `redirectUri` válido (Checkpoint CP2A, inalterado) — uso
   * pretendido: a futura iniciação do OAuth (construção da
   * `authorizationUrl`), que de fato depende da URL de callback estar
   * correta antes de redirecionar o navegador.
   */
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
