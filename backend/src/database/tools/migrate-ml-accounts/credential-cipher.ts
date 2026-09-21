import type { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../../../common/encryption/encryption.service';
import { MigrationAbortedError } from './migrate-ml-accounts.errors';

/**
 * Reutiliza LITERALMENTE o `EncryptionService` da aplicação (AES-256-GCM,
 * payload `iv:authTag:ciphertext` em base64) com uma chave arbitrária, em
 * vez de reimplementar o formato aqui. Qualquer evolução futura do formato
 * acompanha automaticamente o serviço real — nunca há duas implementações
 * podendo divergir em silêncio.
 */
export function createCredentialCipher(rawKey: string): EncryptionService {
  const configStub = {
    get: (key: string): string | undefined =>
      key === 'CREDENTIAL_ENCRYPTION_KEY' ? rawKey : undefined,
  };
  return new EncryptionService(configStub as unknown as ConfigService);
}

export function buildCipher(
  rawKey: string,
  side: 'source' | 'target',
): EncryptionService {
  try {
    return createCredentialCipher(rawKey);
  } catch {
    throw new MigrationAbortedError(
      side === 'source' ? 'SOURCE_KEY_INVALID' : 'TARGET_KEY_INVALID',
    );
  }
}

/**
 * Descriptografa com a chave de origem e recriptografa com a do destino (IV
 * novo e independente por chamada, gerado pelo `EncryptionService`). O
 * plaintext vive apenas no escopo desta função — nunca é registrado,
 * retornado ou exibido. A conferência é feita em memória: o payload novo é
 * descriptografado com a chave do DESTINO e comparado com o plaintext
 * original.
 */
export function reencryptToken(
  payload: string,
  accountId: string,
  sourceCipher: EncryptionService,
  targetCipher: EncryptionService,
): string {
  let plaintext: string;
  try {
    plaintext = sourceCipher.decrypt(payload);
  } catch {
    throw new MigrationAbortedError('SOURCE_DECRYPTION_FAILED', accountId);
  }

  if (plaintext.length === 0) {
    throw new MigrationAbortedError('SOURCE_PLAINTEXT_EMPTY', accountId);
  }

  const reencrypted = targetCipher.encrypt(plaintext);

  let roundTrip: string;
  try {
    roundTrip = targetCipher.decrypt(reencrypted);
  } catch {
    throw new MigrationAbortedError(
      'REENCRYPTION_VERIFICATION_FAILED',
      accountId,
    );
  }

  if (roundTrip !== plaintext || reencrypted === payload) {
    throw new MigrationAbortedError(
      'REENCRYPTION_VERIFICATION_FAILED',
      accountId,
    );
  }

  return reencrypted;
}
