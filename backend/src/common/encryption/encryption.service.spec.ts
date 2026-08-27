import type { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { EncryptionService } from './encryption.service';

function configServiceWithKey(key: string | undefined): ConfigService {
  return { get: () => key } as unknown as ConfigService;
}

const VALID_HEX_KEY = randomBytes(32).toString('hex');
const VALID_BASE64_KEY = randomBytes(32).toString('base64');

describe('EncryptionService', () => {
  describe('key validation (falha rápida no boot)', () => {
    it('throws when CREDENTIAL_ENCRYPTION_KEY is missing', () => {
      expect(
        () => new EncryptionService(configServiceWithKey(undefined)),
      ).toThrow(/CREDENTIAL_ENCRYPTION_KEY não configurada/);
    });

    it('throws when CREDENTIAL_ENCRYPTION_KEY is empty', () => {
      expect(() => new EncryptionService(configServiceWithKey(''))).toThrow(
        /CREDENTIAL_ENCRYPTION_KEY não configurada/,
      );
    });

    it('throws when the hex key does not decode to 32 bytes', () => {
      const tooShortHex = randomBytes(16).toString('hex');
      expect(
        () => new EncryptionService(configServiceWithKey(tooShortHex)),
      ).toThrow(/CREDENTIAL_ENCRYPTION_KEY inválida/);
    });

    it('throws when the base64 key does not decode to 32 bytes', () => {
      const tooShortBase64 = randomBytes(10).toString('base64');
      expect(
        () => new EncryptionService(configServiceWithKey(tooShortBase64)),
      ).toThrow(/CREDENTIAL_ENCRYPTION_KEY inválida/);
    });

    it('accepts a valid 32-byte hex key', () => {
      expect(
        () => new EncryptionService(configServiceWithKey(VALID_HEX_KEY)),
      ).not.toThrow();
    });

    it('accepts a valid 32-byte base64 key', () => {
      expect(
        () => new EncryptionService(configServiceWithKey(VALID_BASE64_KEY)),
      ).not.toThrow();
    });
  });

  describe('encrypt/decrypt round-trip', () => {
    const service = new EncryptionService(configServiceWithKey(VALID_HEX_KEY));

    it('decrypts back to the original plaintext', () => {
      const plaintext = 'segredo-super-sensivel-do-marketplace';
      const encrypted = service.encrypt(plaintext);

      expect(encrypted).not.toBe(plaintext);
      expect(service.decrypt(encrypted)).toBe(plaintext);
    });

    it('produces a different ciphertext for the same plaintext each time (iv aleatório)', () => {
      const plaintext = 'mesmo-valor';
      const first = service.encrypt(plaintext);
      const second = service.encrypt(plaintext);

      expect(first).not.toBe(second);
      expect(service.decrypt(first)).toBe(plaintext);
      expect(service.decrypt(second)).toBe(plaintext);
    });

    it('throws when decrypting a payload with a tampered ciphertext byte', () => {
      const encrypted = service.encrypt('outro-segredo');
      const [iv, authTag, ciphertext] = encrypted.split(':');
      const tamperedBuffer = Buffer.from(ciphertext, 'base64');
      tamperedBuffer[0] = tamperedBuffer[0] ^ 0xff;
      const tampered = [iv, authTag, tamperedBuffer.toString('base64')].join(
        ':',
      );

      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('throws when decrypting a payload with a tampered auth tag byte', () => {
      const encrypted = service.encrypt('mais-um-segredo');
      const [iv, authTag, ciphertext] = encrypted.split(':');
      const tamperedBuffer = Buffer.from(authTag, 'base64');
      tamperedBuffer[0] = tamperedBuffer[0] ^ 0xff;
      const tampered = [iv, tamperedBuffer.toString('base64'), ciphertext].join(
        ':',
      );

      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('throws when decrypting a malformed payload', () => {
      expect(() => service.decrypt('nao-eh-um-payload-valido')).toThrow(
        /formato inválido/,
      );
    });
  });
});
