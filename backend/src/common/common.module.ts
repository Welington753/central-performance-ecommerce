import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption/encryption.service';
import { LoggingInterceptor } from './logging/logging.interceptor';

/**
 * Módulo de utilitários genéricos e transversais (criptografia, logging),
 * sem nenhuma referência a marketplace específico.
 */
@Global()
@Module({
  providers: [EncryptionService, LoggingInterceptor],
  exports: [EncryptionService, LoggingInterceptor],
})
export class CommonModule {}
