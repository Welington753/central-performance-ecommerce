import { randomBytes } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../common/encryption/encryption.service';

/** Chave efêmera gerada por execução — nunca uma chave real/versionada. */
export function createTestEncryptionService(): EncryptionService {
  const key = randomBytes(32).toString('hex');
  return new EncryptionService({
    get: () => key,
  } as unknown as ConfigService);
}
