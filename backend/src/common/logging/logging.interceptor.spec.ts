import { Logger } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

function fakeContext(originalUrl: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        originalUrl,
        url: originalUrl,
        body: {},
        headers: {},
      }),
    }),
  } as unknown as ExecutionContext;
}

function fakeHandler(): CallHandler {
  return { handle: () => of({ ok: true }) };
}

describe('LoggingInterceptor', () => {
  it('never logs the raw query string of a Mercado Livre callback request (code/state must not appear anywhere)', (done) => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const interceptor = new LoggingInterceptor();
    const url =
      '/integrations/mercado-livre/callback?state=secret-state-value&code=secret-code-value';

    interceptor.intercept(fakeContext(url), fakeHandler()).subscribe(() => {
      const loggedText = logSpy.mock.calls
        .map((call) => String(call[0]))
        .join('\n');

      expect(loggedText).not.toContain('secret-state-value');
      expect(loggedText).not.toContain('secret-code-value');
      expect(loggedText).not.toContain('?state=');
      expect(loggedText).toContain('/integrations/mercado-livre/callback');

      logSpy.mockRestore();
      done();
    });
  });

  it('never logs code/state/Bearer token/client_secret in the error path either (error.message can carry them verbatim from a downstream throw)', (done) => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const interceptor = new LoggingInterceptor();
    const failingHandler: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          subscriber.error(
            new Error(
              'upstream call failed for state=secret-state-value&code=secret-code-value, ' +
                'Authorization: Bearer secret-bearer-token, client_secret=secret-client-value',
            ),
          );
        }),
    };

    interceptor
      .intercept(
        fakeContext('/integrations/mercado-livre/callback'),
        failingHandler,
      )
      .subscribe({
        error: () => {
          const loggedText = errorSpy.mock.calls
            .map((call) => String(call[0]))
            .join('\n');

          expect(loggedText).not.toContain('secret-state-value');
          expect(loggedText).not.toContain('secret-code-value');
          expect(loggedText).not.toContain('secret-bearer-token');
          expect(loggedText).not.toContain('secret-client-value');
          expect(loggedText).toContain(
            '/integrations/mercado-livre/callback falhou',
          );

          errorSpy.mockRestore();
          done();
        },
      });
  });
});
