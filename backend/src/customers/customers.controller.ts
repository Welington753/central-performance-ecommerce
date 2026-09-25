import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import {
  BuyerEnrichmentAccountNotFoundError,
  BuyerEnrichmentModeConflictError,
  BuyerEnrichmentService,
  type BuyerEnrichmentStatus,
} from '../integrations/marketplace-sync/buyer-enrichment.service';
import {
  CUSTOMER_PERMISSIONS,
  CustomerPermissionGuard,
  RequireCustomerPermissions,
} from './customer-permissions';
import { CustomersExportService } from './customers-export.service';
import {
  CustomersQueryError,
  parseCustomersFilter,
  parseCustomersPagination,
  type CustomersFilter,
  type RawCustomersQuery,
} from './customers-query';
import type {
  CustomerOrderLineDto,
  CustomersSummaryResponseDto,
} from './customers.dto';
import { CustomersService } from './customers.service';
import { StartBuyerEnrichmentDto } from './dto/start-buyer-enrichment.dto';

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Função "Clientes" (Mercado Livre + Shopee). Primeira versão: tudo exige
 * administrador, via `CustomerPermissionGuard` (permissões já nomeadas para
 * papéis granulares futuros). Nenhum acesso direto a dados aqui.
 */
@ApiTags('customers')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard, CustomerPermissionGuard)
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly exportService: CustomersExportService,
    private readonly enrichmentService: BuyerEnrichmentService,
  ) {}

  @Get('summary')
  @RequireCustomerPermissions(CUSTOMER_PERMISSIONS.VIEW)
  async summary(
    @Query() query: Record<string, unknown>,
  ): Promise<CustomersSummaryResponseDto> {
    const raw = this.normalizeQuery(query);
    const { filter, pagination } = this.parseOrThrow(() => ({
      filter: parseCustomersFilter(raw, new Date()),
      pagination: parseCustomersPagination(raw),
    }));
    return this.customersService.getSummary(filter, pagination);
  }

  /** `.xlsx` gerado sob demanda, direto na resposta — nunca salvo nem com URL pública. */
  @Get('export.xlsx')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @RequireCustomerPermissions(
    CUSTOMER_PERMISSIONS.VIEW,
    CUSTOMER_PERMISSIONS.EXPORT,
  )
  async export(
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
    @CurrentUser() user?: AccessTokenPayload,
  ): Promise<StreamableFile> {
    if (!user) throw new UnauthorizedException('Não autenticado.');
    const raw = this.normalizeQuery(query);
    const filter = this.parseOrThrow(() =>
      parseCustomersFilter(raw, new Date()),
    );
    const includePersonalData = raw.includePersonalData !== 'false';
    if (
      includePersonalData &&
      !(await this.customersService.canExportPersonalData(user.sub))
    ) {
      throw new ForbiddenException('CUSTOMER_PERMISSION_REQUIRED');
    }

    // Cliente desconectou antes do fim → interrompe a geração e libera a
    // conexão do banco (a planilha nunca é concluída em segundo plano).
    const abort = new AbortController();
    response.on('close', () => {
      if (!response.writableFinished) abort.abort();
    });
    const file = await this.exportService.export(
      filter,
      includePersonalData,
      user.sub,
      new Date(),
      abort.signal,
    );
    response.set({
      'Content-Type': XLSX_CONTENT_TYPE,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(file.stream);
  }

  @Get('enrichment/status')
  @RequireCustomerPermissions(CUSTOMER_PERMISSIONS.MANAGE_ENRICHMENT)
  enrichmentStatus(): Promise<BuyerEnrichmentStatus> {
    return this.enrichmentService.getStatus();
  }

  @Post('enrichment/start')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @RequireCustomerPermissions(CUSTOMER_PERMISSIONS.MANAGE_ENRICHMENT)
  startEnrichment(
    @Body() body: StartBuyerEnrichmentDto,
  ): Promise<BuyerEnrichmentStatus> {
    return this.mapEnrichmentErrors(() =>
      this.enrichmentService.start(body.accountId),
    );
  }

  @Post('enrichment/:accountId/pause')
  @HttpCode(HttpStatus.OK)
  @RequireCustomerPermissions(CUSTOMER_PERMISSIONS.MANAGE_ENRICHMENT)
  pauseEnrichment(
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ): Promise<BuyerEnrichmentStatus> {
    return this.mapEnrichmentErrors(() =>
      this.enrichmentService.pause(accountId),
    );
  }

  @Post('enrichment/:accountId/resume')
  @HttpCode(HttpStatus.OK)
  @RequireCustomerPermissions(CUSTOMER_PERMISSIONS.MANAGE_ENRICHMENT)
  resumeEnrichment(
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ): Promise<BuyerEnrichmentStatus> {
    return this.mapEnrichmentErrors(() =>
      this.enrichmentService.resume(accountId),
    );
  }

  @Get(':buyerId/orders')
  @RequireCustomerPermissions(CUSTOMER_PERMISSIONS.VIEW)
  buyerOrders(
    @Param('buyerId', ParseUUIDPipe) buyerId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<CustomerOrderLineDto[]> {
    const raw = this.normalizeQuery(query);
    const filter: CustomersFilter = this.parseOrThrow(() =>
      parseCustomersFilter(raw, new Date()),
    );
    return this.customersService.getBuyerOrders(buyerId, filter);
  }

  /** Parâmetro repetido (`?a=1&a=2`) ou não-string nunca chega aos parsers. */
  private normalizeQuery(query: Record<string, unknown>): RawCustomersQuery {
    const raw: RawCustomersQuery = {};
    for (const [key, value] of Object.entries(query)) {
      if (typeof value !== 'string') {
        throw new BadRequestException('INVALID_QUERY_PARAMETER');
      }
      raw[key] = value;
    }
    return raw;
  }

  private parseOrThrow<T>(parse: () => T): T {
    try {
      return parse();
    } catch (error) {
      if (error instanceof CustomersQueryError) {
        throw new BadRequestException(error.code);
      }
      throw error;
    }
  }

  private async mapEnrichmentErrors<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof BuyerEnrichmentAccountNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof BuyerEnrichmentModeConflictError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }
}
