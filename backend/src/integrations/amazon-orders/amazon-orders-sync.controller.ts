import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  PreconditionFailedException,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import {
  AmazonOrdersSyncError,
  AmazonOrdersSyncService,
  type AmazonOrdersSyncSummary,
} from './amazon-orders-sync.service';

/**
 * Corpo opcional — só o período explícito (allowlist fechada). Nunca
 * aceita nada além disso (design "Endpoints autenticados").
 */
export interface AmazonOrdersSyncRequestBody {
  from?: string;
  to?: string;
}

@ApiTags('amazon-orders')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard)
@Controller('marketplace-accounts/:id/amazon')
export class AmazonOrdersSyncController {
  constructor(private readonly syncService: AmazonOrdersSyncService) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('orders/sync')
  @HttpCode(HttpStatus.OK)
  async syncOrders(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AmazonOrdersSyncRequestBody = {},
  ): Promise<AmazonOrdersSyncSummary> {
    try {
      return await this.syncService.syncOrders(id, {
        from: typeof body.from === 'string' ? body.from : undefined,
        to: typeof body.to === 'string' ? body.to : undefined,
      });
    } catch (error) {
      if (error instanceof AmazonOrdersSyncError) {
        throw this.mapSyncErrorToHttpException(error);
      }
      throw error;
    }
  }

  private mapSyncErrorToHttpException(error: AmazonOrdersSyncError): Error {
    switch (error.code) {
      case 'SYNC_ALREADY_RUNNING':
      case 'ACCOUNT_NOT_CONNECTED':
        return new ConflictException(error.code);
      case 'AMAZON_NOT_CONFIGURED':
        return new PreconditionFailedException(error.code);
      case 'INVALID_PERIOD':
        return new BadRequestException(error.code);
      case 'PROVIDER_RATE_LIMITED':
        return new HttpException(error.code, HttpStatus.TOO_MANY_REQUESTS);
      case 'INVALID_PROVIDER_RESPONSE':
      case 'PROVIDER_REJECTED_REQUEST':
        return new BadGatewayException(error.code);
      case 'PROVIDER_UNAVAILABLE':
      case 'SYNC_FAILED':
      default:
        return new ServiceUnavailableException(error.code);
    }
  }
}
