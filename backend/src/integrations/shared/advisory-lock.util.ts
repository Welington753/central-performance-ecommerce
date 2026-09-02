import { createHash } from 'crypto';

const LOCK_KEY_NAMESPACE = 'central-performance:marketplace-account:';

/**
 * Chave bigint determinística para `pg_try_advisory_lock`/`pg_advisory_unlock`
 * (design §3 do OAuth do Mercado Livre — reaproveitada, sem alteração de
 * comportamento, por qualquer marketplace). Byte order (big-endian) fixo por
 * design — mesmo resultado em qualquer instância/plataforma, independente da
 * endianness do host. Chaveada apenas por `accountId` (um UUID globalmente
 * único em `marketplace_accounts`, independente de marketplace) — nunca
 * colide entre contas de marketplaces diferentes.
 */
export function deriveAdvisoryLockKey(accountId: string): bigint {
  const digest = createHash('sha256')
    .update(LOCK_KEY_NAMESPACE + accountId)
    .digest();
  const unsigned = digest.subarray(0, 8).readBigUInt64BE(0);
  return BigInt.asIntN(64, unsigned);
}
