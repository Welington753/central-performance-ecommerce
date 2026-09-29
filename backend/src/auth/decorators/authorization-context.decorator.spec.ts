import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthorizationContext as AuthorizationContextType } from '../../users/authorization-context.interface';
import { extractAuthorizationContext } from './authorization-context.decorator';

function buildContext(request: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

const SAMPLE_CONTEXT: AuthorizationContextType = {
  userId: 'u1',
  active: true,
  roleKey: 'ADMIN',
  isAdmin: true,
  permissions: [],
  accountScope: { mode: 'ALL' },
  mustChangePassword: false,
};

describe('extractAuthorizationContext', () => {
  it('devolve request.authorizationContext quando presente (populado por PermissionGuard)', () => {
    const context = buildContext({
      authorizationContext: SAMPLE_CONTEXT,
    } as Partial<Request>);

    expect(extractAuthorizationContext(undefined, context)).toBe(
      SAMPLE_CONTEXT,
    );
  });

  it('fail-closed: lança UnauthorizedException quando ausente (rota sem PermissionGuard antes)', () => {
    const context = buildContext({} as Partial<Request>);

    expect(() => extractAuthorizationContext(undefined, context)).toThrow(
      UnauthorizedException,
    );
  });
});
