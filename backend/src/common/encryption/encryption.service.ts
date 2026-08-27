import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const HEX_32_BYTES_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * Serviço genérico de criptografia simétrica (AES-256-GCM), usado para
 * proteger credenciais de marketplace em repouso (access token, refresh
 * token, metadados de credencial). Deliberadamente sem nenhum nome
 * específico de marketplace — é reutilizável por qualquer connector futuro.
 *
 * A chave vem exclusivamente de `CREDENTIAL_ENCRYPTION_KEY` (sem valor
 * padrão). Deve decodificar para exatamente 32 bytes, em hex (64 caracteres)
 * ou base64. Uma chave ausente ou de tamanho incorreto faz o serviço lançar
 * um erro imediatamente na construção (falha rápida no boot da aplicação).
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(configService: ConfigService) {
    this.key = EncryptionService.loadKey(
      configService.get<string>('CREDENTIAL_ENCRYPTION_KEY'),
    );
  }

  private static loadKey(rawKey: string | undefined): Buffer {
    if (!rawKey || rawKey.trim().length === 0) {
      throw new Error(
        'CREDENTIAL_ENCRYPTION_KEY não configurada. Defina uma chave de 32 bytes (hex ou base64) na variável de ambiente antes de subir a aplicação.',
      );
    }

    const key = EncryptionService.decodeKey(rawKey);

    if (key.length !== KEY_LENGTH_BYTES) {
      throw new Error(
        `CREDENTIAL_ENCRYPTION_KEY inválida: esperado ${KEY_LENGTH_BYTES} bytes, obtido ${key.length}. Use uma chave em hex (64 caracteres) ou base64 que decodifique para exatamente 32 bytes.`,
      );
    }

    return key;
  }

  private static decodeKey(rawKey: string): Buffer {
    if (HEX_32_BYTES_PATTERN.test(rawKey)) {
      return Buffer.from(rawKey, 'hex');
    }
    return Buffer.from(rawKey, 'base64');
  }

  /**
   * Criptografa um texto puro e retorna um payload serializado no formato
   * `iv:authTag:ciphertext`, cada parte em base64.
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  /**
   * Descriptografa um payload gerado por `encrypt`. Lança erro se o payload
   * estiver em formato inválido ou se tiver sido adulterado (o GCM detecta
   * isso nativamente através da falha de verificação da auth tag).
   */
  decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 3) {
      throw new Error('Payload criptografado em formato inválido.');
    }

    const [ivBase64, authTagBase64, ciphertextBase64] = parts;
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const ciphertext = Buffer.from(ciphertextBase64, 'base64');

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
