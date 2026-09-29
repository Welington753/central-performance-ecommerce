import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { AuthorizationContext } from '../auth/decorators/authorization-context.decorator';
import {
  PermissionGuard,
  RequirePermissions,
} from '../auth/guards/permission.guard';
import type { AuthorizationContext as AuthorizationContextType } from '../users/authorization-context.interface';
import { PERMISSIONS } from '../users/permissions.catalog';
import { ListSyncRunsQueryDto } from './dto/list-sync-runs.query.dto';
import { SyncRun } from './sync-run.entity';
import { SyncRunsService } from './sync-runs.service';

/**
 * Checkpoint 5A: exige `sync.view` e usa SOMENTE `findAllForScope` (nunca o
 * `findAll` interno, de uso restrito a workers/services já existentes) —
 * `ALL`/`SELECTED`/`NONE` filtrados no banco, nunca em memória.
 */
@ApiTags('sync-runs')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard, PermissionGuard)
@Controller('sync-runs')
export class SyncRunsController {
  constructor(private readonly syncRunsService: SyncRunsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SYNC_VIEW)
  findAll(
    @Query() query: ListSyncRunsQueryDto,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<SyncRun[]> {
    return this.syncRunsService.findAllForScope(query, context.accountScope);
  }
}
