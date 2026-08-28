import { createHash } from 'crypto';

const LOCK_KEY_NAMESPACE = 'central-performance:mercado-livre:account:';

/**
 * Chave bigint determinística para `pg_try_advisory_lock`/`pg_advisory_unlock`
 * (design §3). Byte order (big-endian) fixo por design — mesmo resultado em
 * qualquer instância/plataforma, independente da endianness do host.
 */
export function deriveAdvisoryLockKey(accountId: string): bigint {
  const digest = createHash('sha256')
    .update(LOCK_KEY_NAMESPACE + accountId)
    .digest();
  const unsigned = digest.subarray(0, 8).readBigUInt64BE(0);
  return BigInt.asIntN(64, unsigned);
}
