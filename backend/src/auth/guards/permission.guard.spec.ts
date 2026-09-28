import 'reflect-metadata';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthorizationContext } from '../../users/authorization-context.interface';
import { PERMISSIONS } from '../../users/permissions.catalog';
import type { AuthorizationContextService } from '../authorization-context.service';
import {
  PermissionGuard,
  RequireAnyPermission,
  RequirePermissions,
} from './permission.guard';

// `buildFakeReflector` abaixo ignora handler/classe e devolve metadata fixa —
// então o handler/classe do contexto de execução não precisam carregar
// metadata real nenhuma.
function buildContext(request: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function buildAuthorizationContext(
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

function buildFakeReflector(metadata: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: (key: string) => metadata[key],
  } as unknown as Reflector;
}

describe('PermissionGuard', () => {
  it('sem request.user (AccessTokenGuard não composto antes) -> 401, nunca resolve autorização', async () => {
    const resolveForRequest = jest.fn();
    const authorizationContextService = {
      resolveForRequest,
    } as unknown as AuthorizationContextService;
    const reflector = buildFakeReflector({
      requireAllPermissions: [PERMISSIONS.DASHBOARD_VIEW],
    });
    const guard = new PermissionGuard(reflector, authorizationContextService);
    const context = buildContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(resolveForRequest).not.toHaveBeenCalled();
  });

  it('autenticado, com a permissão exigida -> permite', async () => {
    const authorizationContextService = {
      resolveForRequest: jest.fn().mockResolvedValue(
        buildAuthorizationContext({
          permissions: [PERMISSIONS.DASHBOARD_VIEW],
        }),
      ),
    } as unknown as AuthorizationContextService;
    const reflector = buildFakeReflector({
      requireAllPermissions: [PERMISSIONS.DASHBOARD_VIEW],
    });
    const guard = new PermissionGuard(reflector, authorizationContextService);
    const context = buildContext({ user: { sub: 'u1', email: 'a@b.com' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('autenticado, sem a permissão exigida -> 403', async () => {
    const authorizationContextService = {
      resolveForRequest: jest.fn().mockResolvedValue(
        buildAuthorizationContext({
          permissions: [PERMISSIONS.DASHBOARD_VIEW],
        }),
      ),
    } as unknown as AuthorizationContextService;
    const reflector = buildFakeReflector({
      requireAllPermissions: [PERMISSIONS.USERS_MANAGE],
    });
    const guard = new PermissionGuard(reflector, authorizationContextService);
    const context = buildContext({ user: { sub: 'u1', email: 'a@b.com' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('usuário inativo (contexto active=false) -> 403, mesmo se por acaso tivesse a chave', async () => {
    const authorizationContextService = {
      resolveForRequest: jest.fn().mockResolvedValue(
        buildAuthorizationContext({
          active: false,
          permissions: [PERMISSIONS.DASHBOARD_VIEW],
        }),
      ),
    } as unknown as AuthorizationContextService;
    const reflector = buildFakeReflector({
      requireAllPermissions: [PERMISSIONS.DASHBOARD_VIEW],
    });
    const guard = new PermissionGuard(reflector, authorizationContextService);
    const context = buildContext({ user: { sub: 'u1', email: 'a@b.com' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('38. mustChangePassword=true -> 403 PASSWORD_CHANGE_REQUIRED, mesmo tendo a permissão', async () => {
    const authorizationContextService = {
      resolveForRequest: jest.fn().mockResolvedValue(
        buildAuthorizationContext({
          permissions: [PERMISSIONS.DASHBOARD_VIEW],
          mustChangePassword: true,
        }),
      ),
    } as unknown as AuthorizationContextService;
    const reflector = buildFakeReflector({
      requireAllPermissions: [PERMISSIONS.DASHBOARD_VIEW],
    });
    const guard = new PermissionGuard(reflector, authorizationContextService);
    const context = buildContext({ user: { sub: 'u1', email: 'a@b.com' } });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      message: 'PASSWORD_CHANGE_REQUIRED',
    });
  });

  it('@RequirePermissions exige TODAS — falta uma já nega', async () => {
    const authorizationContextService = {
      resolveForRequest: jest.fn().mockResolvedValue(
        buildAuthorizationContext({
          permissions: [PERMISSIONS.DASHBOARD_VIEW],
        }),
      ),
    } as unknown as AuthorizationContextService;
    const reflector = buildFakeReflector({
      requireAllPermissions: [
        PERMISSIONS.DASHBOARD_VIEW,
        PERMISSIONS.FULL_VIEW,
      ],
    });
    const guard = new PermissionGuard(reflector, authorizationContextService);
    const context = buildContext({ user: { sub: 'u1', email: 'a@b.com' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('@RequireAnyPermission exige pelo menos uma — uma das duas já basta', async () => {
    const authorizationContextService = {
      resolveForRequest: jest.fn().mockResolvedValue(
        buildAuthorizationContext({
          permissions: [PERMISSIONS.FULL_VIEW],
        }),
      ),
    } as unknown as AuthorizationContextService;
    const reflector = buildFakeReflector({
      requireAnyPermission: [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.FULL_VIEW],
    });
    const guard = new PermissionGuard(reflector, authorizationContextService);
    const context = buildContext({ user: { sub: 'u1', email: 'a@b.com' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('@RequireAnyPermission nega quando nenhuma das opções está presente', async () => {
    const authorizationContextService = {
      resolveForRequest: jest
        .fn()
        .mockResolvedValue(
          buildAuthorizationContext({ permissions: [PERMISSIONS.SYNC_VIEW] }),
        ),
    } as unknown as AuthorizationContextService;
    const reflector = buildFakeReflector({
      requireAnyPermission: [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.FULL_VIEW],
    });
    const guard = new PermissionGuard(reflector, authorizationContextService);
    const context = buildContext({ user: { sub: 'u1', email: 'a@b.com' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rota SEM nenhuma metadata de permissão nunca é liberada por acidente -> nega', async () => {
    const resolveForRequest = jest.fn();
    const authorizationContextService = {
      resolveForRequest,
    } as unknown as AuthorizationContextService;
    const reflector = buildFakeReflector({});
    const guard = new PermissionGuard(reflector, authorizationContextService);
    const context = buildContext({ user: { sub: 'u1', email: 'a@b.com' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Nem chega a resolver o contexto — nega antes, só por falta de metadata.
    expect(resolveForRequest).not.toHaveBeenCalled();
  });

  it('metadata inválida (array vazio) é tratada como ausência de metadata -> nega', async () => {
    const authorizationContextService = {
      resolveForRequest: jest.fn(),
    } as unknown as AuthorizationContextService;
    const reflector = buildFakeReflector({ requireAllPermissions: [] });
    const guard = new PermissionGuard(reflector, authorizationContextService);
    const context = buildContext({ user: { sub: 'u1', email: 'a@b.com' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('reutiliza o mesmo contexto de autorização já resolvido na requisição (via AuthorizationContextService)', async () => {
    const resolveForRequest = jest.fn().mockResolvedValue(
      buildAuthorizationContext({
        permissions: [PERMISSIONS.DASHBOARD_VIEW],
      }),
    );
    const authorizationContextService = {
      resolveForRequest,
    } as unknown as AuthorizationContextService;
    const reflector = buildFakeReflector({
      requireAllPermissions: [PERMISSIONS.DASHBOARD_VIEW],
    });
    const guard = new PermissionGuard(reflector, authorizationContextService);
    const request: Partial<Request> = { user: { sub: 'u1', email: 'a@b.com' } };

    await guard.canActivate(buildContext(request));
    // A responsabilidade de "só uma vez" é do AuthorizationContextService
    // (testado isoladamente); aqui só provamos que o guard SEMPRE passa
    // pelo mesmo ponto de entrada, nunca resolve por conta própria.
    expect(resolveForRequest).toHaveBeenCalledWith(request);
  });
});

describe('decorators RequirePermissions/RequireAnyPermission', () => {
  it('SetMetadata grava a lista tipada exatamente como recebida', () => {
    class Controller {
      @RequirePermissions(PERMISSIONS.USERS_MANAGE)
      handler(this: void): void {}

      @RequireAnyPermission(PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.FULL_VIEW)
      anyHandler(this: void): void {}
    }

    const instance = new Controller();
    expect(
      Reflect.getMetadata('requireAllPermissions', instance.handler),
    ).toEqual([PERMISSIONS.USERS_MANAGE]);
    expect(
      Reflect.getMetadata('requireAnyPermission', instance.anyHandler),
    ).toEqual([PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.FULL_VIEW]);
  });
});
