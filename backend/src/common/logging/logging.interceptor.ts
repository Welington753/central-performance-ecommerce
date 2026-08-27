import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import { redactSensitiveData } from './redact.util';

/**
 * Loga método/rota de cada requisição HTTP com o corpo e os headers
 * mascarados por `redactSensitiveData`, garantindo que segredos (senha,
 * tokens, Authorization, Cookie) nunca cheguem em texto puro aos logs.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const safeBody = redactSensitiveData(request.body as unknown);
    const safeHeaders = redactSensitiveData(request.headers as unknown);

    this.logger.log(
      `${request.method} ${request.originalUrl ?? request.url} ${JSON.stringify(
        {
          body: safeBody,
          headers: safeHeaders,
        },
      )}`,
    );

    return next.handle().pipe(
      tap({
        next: () =>
          this.logger.log(
            `${request.method} ${request.originalUrl ?? request.url} concluído`,
          ),
        error: (error: unknown) =>
          this.logger.error(
            `${request.method} ${request.originalUrl ?? request.url} falhou: ${
              error instanceof Error ? error.message : 'erro desconhecido'
            }`,
          ),
      }),
    );
  }
}
