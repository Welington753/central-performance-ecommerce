import 'reflect-metadata';
import { Controller, Get } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../guards/access-token.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { PERMISSIONS } from '../../users/permissions.catalog';
import { RequireAuthorizedPermissions } from './require-authorized-permissions.decorator';

describe('RequireAuthorizedPermissions (decorator composto)', () => {
  it('aplica AccessTokenGuard antes de PermissionGuard, nesta ordem, sem duplicar lógica de autenticação', () => {
    @Controller()
    class TestController {
      @RequireAuthorizedPermissions(PERMISSIONS.USERS_MANAGE)
      @Get()
      handler(this: void): void {}
    }

    const instance = new TestController();
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      instance.handler,
    ) as unknown[];

    expect(guards).toEqual([AccessTokenGuard, PermissionGuard]);
  });

  it('grava a metadata de permissão exigida (requireAllPermissions), reaproveitando RequirePermissions', () => {
    @Controller()
    class TestController {
      @RequireAuthorizedPermissions(
        PERMISSIONS.SYNC_RUN,
        PERMISSIONS.SYNC_BACKFILL,
      )
      @Get()
      handler(this: void): void {}
    }

    const instance = new TestController();
    expect(
      Reflect.getMetadata('requireAllPermissions', instance.handler),
    ).toEqual([PERMISSIONS.SYNC_RUN, PERMISSIONS.SYNC_BACKFILL]);
  });
});
