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
import { sanitizeSensitiveSubstrings } from './sanitize-string.util';

/**
 * Loga método/caminho de cada requisição HTTP com o corpo e os headers
 * mascarados por `redactSensitiveData`, garantindo que segredos (senha,
 * tokens, Authorization, Cookie) nunca cheguem em texto puro aos logs.
 *
 * A QUERY STRING nunca é logada (design §8) — só o `pathname`. Isso é
 * essencial para o callback do Mercado Livre
 * (`GET /integrations/mercado-livre/callback?state=...&code=...`), cuja
 * query string carrega `code`/`state` diretamente.
 *
 * A mensagem de erro no caminho de falha também passa por
 * `sanitizeSensitiveSubstrings` antes de ser interpolada no log: uma
 * exceção lançada por dependências (ex.: erro HTTP do cliente Mercado
 * Livre, driver do Postgres) pode conter `code`/`state`/Bearer token/
 * `client_secret` no seu `message`, e isso não passaria por
 * `redactSensitiveData` (que só sanitiza objetos estruturados, não texto
 * livre) se fosse interpolado diretamente.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const path = this.safePath(request);
    const safeBody = redactSensitiveData(request.body as unknown);
    const safeHeaders = redactSensitiveData(request.headers as unknown);

    this.logger.log(
      `${request.method} ${path} ${JSON.stringify({
        body: safeBody,
        headers: safeHeaders,
      })}`,
    );

    return next.handle().pipe(
      tap({
        next: () => this.logger.log(`${request.method} ${path} concluído`),
        error: (error: unknown) => {
          const rawMessage =
            error instanceof Error ? error.message : 'erro desconhecido';
          this.logger.error(
            `${request.method} ${path} falhou: ${sanitizeSensitiveSubstrings(rawMessage)}`,
          );
        },
      }),
    );
  }

  private safePath(request: Request): string {
    const raw = request.originalUrl ?? request.url;
    const queryIndex = raw.indexOf('?');
    return queryIndex === -1 ? raw : raw.slice(0, queryIndex);
  }
}
