import type { ShopeeCallbackOutcome } from './shopee-oauth.service';

/**
 * Vocabulário público pequeno e fechado (Checkpoint CP2D) — nunca os
 * `failureCode` internos (`TOKEN_EXCHANGE_REJECTED`, `SHOP_ALREADY_CONNECTED`
 * etc., ver `shopee-oauth-failure-code.ts`), nunca mensagem da Shopee, nunca
 * `code`/`state`/`shopId`/Partner ID/Key.
 */
export type ShopeeOAuthPublicReason =
  'OAUTH_CALLBACK_INVALID' | 'CONNECTION_FAILED' | 'CONNECTION_BUSY';

const REASON_BY_OUTCOME_KIND: Record<
  Exclude<ShopeeCallbackOutcome['kind'], 'success'>,
  ShopeeOAuthPublicReason
> = {
  invalid_callback: 'OAUTH_CALLBACK_INVALID',
  connection_failed: 'CONNECTION_FAILED',
  lock_unavailable: 'CONNECTION_BUSY',
};

export function mapShopeeCallbackOutcomeToPublicReason(
  kind: Exclude<ShopeeCallbackOutcome['kind'], 'success'>,
): ShopeeOAuthPublicReason {
  return REASON_BY_OUTCOME_KIND[kind];
}
