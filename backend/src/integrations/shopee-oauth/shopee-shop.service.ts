import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { ShopeeAccessTokenService } from './shopee-access-token.service';
import {
  ShopeeShopApiClient,
  ShopeeShopInfoOutcome,
} from './shopee-shop-api.client';
import {
  ShopeeShopInfoResult,
  ShopeeShopStatus,
} from './shopee-shop-info-response';

/**
 * Vocabulário público fechado (Checkpoint CP2J) — nunca a mensagem/`error`
 * bruta da Shopee, nunca o `failureCode` interno de
 * `ShopeeAccessTokenService`. Cada código mapeia para EXATAMENTE um status
 * HTTP no controller (`shopee-shop.controller.ts`), nunca dois.
 */
export type ShopeeShopErrorCode =
  | 'SHOPEE_NOT_CONNECTED'
  | 'SHOPEE_CONNECTION_BUSY'
  | 'SHOPEE_NOT_CONFIGURED'
  | 'SHOPEE_DATA_UNAVAILABLE'
  | 'SHOPEE_TEMPORARILY_UNAVAILABLE';

export class ShopeeShopServiceError extends Error {
  constructor(public readonly code: ShopeeShopErrorCode) {
    super(code);
  }
}

/**
 * Contrato de resposta pública (Checkpoint CP2J) — EXATAMENTE estes seis
 * campos, vocabulário fechado. Nunca `requestId`, `message`, o objeto bruto,
 * `shopId`/`externalSellerId`, `tokenExpiresAt`, `tokenVersion`, contadores
 * internos ou qualquer credencial.
 */
export interface ShopeeShopInfoPublicDto {
  shopName: string;
  region: string;
  status: ShopeeShopStatus;
  authorizationGrantedAt: string;
  authorizationExpiresAt: string;
  merchantId: number | null;
}

/**
 * Orquestração da consulta de informações básicas de uma loja Shopee
 * (Checkpoint CP2J, `GET /marketplace-accounts/:id/shopee/shop-info`) —
 * serviço de aplicação dedicado, nunca um método a mais em
 * `ShopeeOAuthService` (já grande). Só LEITURA: nenhuma escrita em
 * `MarketplaceAccountsService` (a única chamada é `findByIdOrFail`) — as
 * escritas de renovação/falha continuam exclusivamente dentro de
 * `ShopeeAccessTokenService` (nenhuma lógica de refresh duplicada aqui).
 *
 * `ShopeeAccessTokenService.ensureValidShopCredentials` é o ÚNICO ponto que
 * fornece `accessToken`+`shopId` — sempre emparelhados da mesma
 * leitura/versão da conta (nunca um `shopId` relido separadamente, o que
 * arriscaria misturar token antigo com shop novo numa reconexão
 * concorrente).
 */
@Injectable()
export class ShopeeShopService {
  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly accessTokenService: ShopeeAccessTokenService,
    private readonly shopApiClient: ShopeeShopApiClient,
  ) {}

  async getShopInfo(accountId: string): Promise<ShopeeShopInfoPublicDto> {
    const account =
      await this.marketplaceAccountsService.findByIdOrFail(accountId);

    if (account.marketplace !== Marketplace.SHOPEE) {
      // Mesma mensagem de `findByIdOrFail` — nunca revela publicamente que o
      // UUID existe mas pertence a outro marketplace.
      throw new NotFoundException('Conta de marketplace não encontrada.');
    }
    if (account.status !== MarketplaceAccountStatus.CONNECTED) {
      throw new ShopeeShopServiceError('SHOPEE_NOT_CONNECTED');
    }

    const credentials = await this.resolveCredentials(accountId);
    const outcome = await this.shopApiClient.getShopInfo(credentials);
    return this.toPublicDto(outcome);
  }

  private async resolveCredentials(
    accountId: string,
  ): Promise<{ accessToken: string; shopId: string }> {
    try {
      return await this.accessTokenService.ensureValidShopCredentials(
        accountId,
      );
    } catch (error) {
      throw this.mapCredentialsError(error);
    }
  }

  /**
   * Traduz o vocabulário fechado de `ShopeeAccessTokenService`
   * (`ConflictException` com um `message`/código interno) para o vocabulário
   * público desta camada — nunca deixa o código interno vazar como está.
   */
  private mapCredentialsError(error: unknown): Error {
    if (!(error instanceof ConflictException)) {
      return error as Error;
    }
    switch (error.message) {
      case 'ACCOUNT_BUSY':
      case 'REFRESH_RESULT_NOT_COMMITTED':
        return new ShopeeShopServiceError('SHOPEE_CONNECTION_BUSY');
      case 'SHOPEE_NOT_CONFIGURED':
        return new ShopeeShopServiceError('SHOPEE_NOT_CONFIGURED');
      case 'ACCOUNT_NOT_ELIGIBLE':
      case 'INVALID_AUTHORIZATION_RESPONSE':
      case 'REFRESH_FAILED':
      case 'REFRESH_RESULT_AMBIGUOUS':
      case 'CREDENTIAL_DECRYPTION_FAILED':
      default:
        // Vocabulário fechado defensivo: qualquer código de
        // `ShopeeAccessTokenService` ainda não listado explicitamente cai
        // aqui, nunca propaga cru.
        return new ShopeeShopServiceError('SHOPEE_NOT_CONNECTED');
    }
  }

  private toPublicDto(outcome: ShopeeShopInfoOutcome): ShopeeShopInfoPublicDto {
    switch (outcome.kind) {
      case 'success':
        return this.buildDto(outcome.shopInfo);
      case 'configuration_error':
      case 'invalid_request':
        // Ambos só ocorrem por config/entrada ausente/inválida — nunca causa
        // do chamador desta rota (accessToken/shopId já validados por
        // `ensureValidShopCredentials`). Classificação conservadora.
        throw new ShopeeShopServiceError('SHOPEE_NOT_CONFIGURED');
      case 'provider_rejected':
      case 'invalid_response':
        // A Shopee respondeu, mas com rejeição/corpo inválido — mesmo
        // espírito de `BadGatewayException` já usado no projeto para
        // "provedor respondeu, mas mal" (ver `AmazonOrdersSyncController`).
        throw new ShopeeShopServiceError('SHOPEE_DATA_UNAVAILABLE');
      case 'rate_limited':
      case 'temporary_failure':
      case 'unknown_result':
        // Rate limit, 5xx idempotente ou ambiguidade de rede — nenhum deles
        // é uma rejeição definitiva; todos retryable mais tarde pelo
        // chamador.
        throw new ShopeeShopServiceError('SHOPEE_TEMPORARILY_UNAVAILABLE');
    }
  }

  private buildDto(shopInfo: ShopeeShopInfoResult): ShopeeShopInfoPublicDto {
    if (shopInfo.expireTime < shopInfo.authTime) {
      // Defesa em profundidade: `shopee-shop-info-response.ts` já garante
      // isto, mas esta camada nunca confia duas vezes sem reconferir no
      // limite seguinte.
      throw new ShopeeShopServiceError('SHOPEE_DATA_UNAVAILABLE');
    }

    return {
      shopName: shopInfo.shopName,
      region: shopInfo.region,
      status: shopInfo.status,
      authorizationGrantedAt: this.toIsoUtc(shopInfo.authTime),
      authorizationExpiresAt: this.toIsoUtc(shopInfo.expireTime),
      merchantId: shopInfo.merchantId,
    };
  }

  /** `Date.prototype.toISOString()` é sempre UTC (sufixo `Z`) — nunca timezone local. */
  private toIsoUtc(unixSeconds: number): string {
    const date = new Date(unixSeconds * 1000);
    if (Number.isNaN(date.getTime())) {
      throw new ShopeeShopServiceError('SHOPEE_DATA_UNAVAILABLE');
    }
    return date.toISOString();
  }
}
