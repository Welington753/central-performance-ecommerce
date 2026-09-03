import {
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import {
  BackfillError,
  MarketplaceBackfillService,
  type BackfillChunkResult,
  type BackfillStatus,
} from './marketplace-backfill.service';

@ApiTags('marketplace-sync')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard)
@Controller('marketplace-accounts/:id/backfill')
export class MarketplaceBackfillController {
  constructor(private readonly backfillService: MarketplaceBackfillService) {}

  @Get('status')
  async status(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BackfillStatus> {
    return this.backfillService.getStatus(id);
  }

  // Sem `@Body()`: um chunk por chamada — o chamador decide quando parar de
  // repetir com base em `hasMoreHistory` (design "Histórico completo").
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('next-chunk')
  @HttpCode(HttpStatus.OK)
  async nextChunk(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BackfillChunkResult> {
    try {
      return await this.backfillService.runNextChunk(id);
    } catch (error) {
      if (error instanceof BackfillError) {
        throw this.mapErrorToHttpException(error);
      }
      throw error;
    }
  }

  private mapErrorToHttpException(error: BackfillError): Error {
    switch (error.code) {
      case 'ACCOUNT_NOT_CONNECTED':
      case 'NO_INITIAL_SYNC_YET':
      case 'MARKETPLACE_NOT_SUPPORTED':
        return new NotFoundException(error.code);
      case 'BACKFILL_ALREADY_RUNNING':
        return new ConflictException(error.code);
      case 'AMAZON_NOT_CONFIGURED':
      case 'SYNC_FAILED':
      default:
        return new ServiceUnavailableException(error.code);
    }
  }
}
