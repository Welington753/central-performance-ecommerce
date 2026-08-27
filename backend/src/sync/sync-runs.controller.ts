import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { ListSyncRunsQueryDto } from './dto/list-sync-runs.query.dto';
import { SyncRun } from './sync-run.entity';
import { SyncRunsService } from './sync-runs.service';

@ApiTags('sync-runs')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard)
@Controller('sync-runs')
export class SyncRunsController {
  constructor(private readonly syncRunsService: SyncRunsService) {}

  @Get()
  findAll(@Query() query: ListSyncRunsQueryDto): Promise<SyncRun[]> {
    return this.syncRunsService.findAll(query);
  }
}
