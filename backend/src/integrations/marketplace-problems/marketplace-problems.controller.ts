import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthorizationContext } from '../../auth/decorators/authorization-context.decorator';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import {
  PermissionGuard,
  RequirePermissions,
} from '../../auth/guards/permission.guard';
import type { AuthorizationContext as AuthorizationContextType } from '../../users/authorization-context.interface';
import { PERMISSIONS } from '../../users/permissions.catalog';
import { UpdateProblemResponsibilityDto } from './dto/problems-body.dto';
import {
  ListProblemsQueryDto,
  ProblemsFilterQueryDto,
  ProblemsMonthlyQueryDto,
} from './dto/problems-query.dto';
import { MarketplaceProblemsListQueryService } from './marketplace-problems-list-query.service';
import { MarketplaceProblemsMonthlyQueryService } from './marketplace-problems-monthly-query.service';
import { MarketplaceProblemsResponsibilityService } from './marketplace-problems-responsibility.service';
import { MarketplaceProblemsSummaryQueryService } from './marketplace-problems-summary-query.service';
import { MarketplaceProblemsSyncManagementService } from './marketplace-problems-sync-management.service';
import type {
  ProblemDetailDto,
  ProblemReasonOptionDto,
  ProblemsMonthlyDto,
  ProblemsPageDto,
  ProblemsSummaryDto,
  ProblemsSyncStatusDto,
} from './marketplace-problems.types';

/**
 * API de "Problemas". `AccessTokenGuard` + `PermissionGuard` em TODAS as
 * rotas; o account scope (`AuthorizationContext.accountScope`) é aplicado na
 * própria query/escrita — nunca só pelo `accountId` que o cliente envia. Nada
 * aqui executa tick nem chama o Mercado Livre: os controles do job só gravam
 * estado durável.
 *
 * ORDEM: as rotas estáticas (`summary`, `reasons`, `monthly`, `sync/...`) são declaradas
 * ANTES de `:id`; além disso `:id` exige UUID (`ParseUUIDPipe`), então uma
 * rota estática nunca pode ser capturada como id.
 */
@ApiTags('problems')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard, PermissionGuard)
@Controller('problems')
export class MarketplaceProblemsController {
  constructor(
    private readonly listQuery: MarketplaceProblemsListQueryService,
    private readonly summaryQuery: MarketplaceProblemsSummaryQueryService,
    private readonly monthlyQuery: MarketplaceProblemsMonthlyQueryService,
    private readonly responsibility: MarketplaceProblemsResponsibilityService,
    private readonly syncManagement: MarketplaceProblemsSyncManagementService,
  ) {}

  @Get('summary')
  @RequirePermissions(PERMISSIONS.PROBLEMS_VIEW)
  summary(
    @Query() query: ProblemsFilterQueryDto,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<ProblemsSummaryDto> {
    return this.summaryQuery.summary(query, context.accountScope);
  }

  @Get('reasons')
  @RequirePermissions(PERMISSIONS.PROBLEMS_VIEW)
  reasons(
    @Query() query: ProblemsFilterQueryDto,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<ProblemReasonOptionDto[]> {
    return this.summaryQuery.reasons(query, context.accountScope);
  }

  /** Análise mensal por conta (America/Sao_Paulo) — taxa por 100 pedidos, resolução e cobertura. */
  @Get('monthly')
  @RequirePermissions(PERMISSIONS.PROBLEMS_VIEW)
  monthly(
    @Query() query: ProblemsMonthlyQueryDto,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<ProblemsMonthlyDto> {
    return this.monthlyQuery.monthly(query, context.accountScope);
  }

  @Get('sync/status')
  @RequirePermissions(PERMISSIONS.PROBLEMS_VIEW)
  syncStatus(
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<ProblemsSyncStatusDto[]> {
    return this.syncManagement.status(context.accountScope);
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('sync/accounts/:accountId/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PROBLEMS_SYNC)
  syncStart(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<ProblemsSyncStatusDto> {
    return this.syncManagement.start(context.accountScope, accountId);
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('sync/accounts/:accountId/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PROBLEMS_SYNC)
  syncPause(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<ProblemsSyncStatusDto> {
    return this.syncManagement.pause(context.accountScope, accountId);
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('sync/accounts/:accountId/resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PROBLEMS_SYNC)
  syncResume(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<ProblemsSyncStatusDto> {
    return this.syncManagement.resume(context.accountScope, accountId);
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('sync/accounts/:accountId/historical/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PROBLEMS_SYNC)
  historicalPause(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<ProblemsSyncStatusDto> {
    return this.syncManagement.pauseHistorical(context.accountScope, accountId);
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('sync/accounts/:accountId/historical/resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PROBLEMS_SYNC)
  historicalResume(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<ProblemsSyncStatusDto> {
    return this.syncManagement.resumeHistorical(
      context.accountScope,
      accountId,
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PROBLEMS_VIEW)
  list(
    @Query() query: ListProblemsQueryDto,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<ProblemsPageDto> {
    const { page, pageSize, sortBy, sortDir, ...filters } = query;
    return this.listQuery.list(filters, context.accountScope, {
      page,
      pageSize,
      sortBy,
      sortDir,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PROBLEMS_VIEW)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<ProblemDetailDto> {
    return this.listQuery.findOne(id, context.accountScope);
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Patch(':id/responsibility')
  @RequirePermissions(PERMISSIONS.PROBLEMS_MANAGE)
  updateResponsibility(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProblemResponsibilityDto,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<ProblemDetailDto> {
    return this.responsibility.override(
      id,
      context.accountScope,
      context.userId,
      body,
    );
  }
}
