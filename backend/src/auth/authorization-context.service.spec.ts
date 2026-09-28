import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthorizationContext } from '../users/authorization-context.interface';
import type { PermissionResolverService } from '../users/permission-resolver.service';
import { AuthorizationContextService } from './authorization-context.service';

function buildContext(
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return {
    userId: 'u1',
    active: true,
    roleKey: 'VIEWER',
    isAdmin: false,
    permissions: [],
    accountScope: { mode: 'NONE' },
    mustChangePassword: false,
    ...overrides,
  };
}

describe('AuthorizationContextService', () => {
  it('resolve via PermissionResolverService quando a requisição ainda não tem contexto anexado', async () => {
    const resolved = buildContext();
    const resolve = jest.fn().mockResolvedValue(resolved);
    const resolver = { resolve } as unknown as PermissionResolverService;
    const service = new AuthorizationContextService(resolver);
    const request: Partial<Request> = { user: { sub: 'u1', email: 'a@b.com' } };

    const context = await service.resolveForRequest(request as Request);

    expect(context).toBe(resolved);
    expect(resolve).toHaveBeenCalledWith('u1');
    expect(request.authorizationContext).toBe(resolved);
  });

  it('carrega o contexto no máximo uma vez por requisição — segunda chamada reaproveita o já anexado', async () => {
    const resolved = buildContext();
    const resolve = jest.fn().mockResolvedValue(resolved);
    const resolver = { resolve } as unknown as PermissionResolverService;
    const service = new AuthorizationContextService(resolver);
    const request: Partial<Request> = { user: { sub: 'u1', email: 'a@b.com' } };

    await service.resolveForRequest(request as Request);
    await service.resolveForRequest(request as Request);
    await service.resolveForRequest(request as Request);

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('duas requisições diferentes (objetos Request distintos) resolvem de forma independente', async () => {
    const resolve = jest
      .fn()
      .mockResolvedValueOnce(buildContext({ userId: 'u1' }))
      .mockResolvedValueOnce(buildContext({ userId: 'u2' }));
    const resolver = { resolve } as unknown as PermissionResolverService;
    const service = new AuthorizationContextService(resolver);
    const requestA: Partial<Request> = {
      user: { sub: 'u1', email: 'a@b.com' },
    };
    const requestB: Partial<Request> = {
      user: { sub: 'u2', email: 'b@b.com' },
    };

    const contextA = await service.resolveForRequest(requestA as Request);
    const contextB = await service.resolveForRequest(requestB as Request);

    expect(contextA.userId).toBe('u1');
    expect(contextB.userId).toBe('u2');
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('lança 401 se chamado sem request.user (nunca resolve com id vazio/inventado)', async () => {
    const resolve = jest.fn();
    const resolver = { resolve } as unknown as PermissionResolverService;
    const service = new AuthorizationContextService(resolver);
    const request: Partial<Request> = {};

    await expect(
      service.resolveForRequest(request as Request),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resolve).not.toHaveBeenCalled();
  });
});
