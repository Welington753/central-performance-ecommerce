import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { ListSyncRunsQueryDto } from './dto/list-sync-runs.query.dto';
import { SyncRun } from './sync-run.entity';

@Injectable()
export class SyncRunsService {
  constructor(
    @InjectRepository(SyncRun)
    private readonly repository: Repository<SyncRun>,
  ) {}

  findAll(filter: ListSyncRunsQueryDto = {}): Promise<SyncRun[]> {
    const where: FindOptionsWhere<SyncRun> = {};

    if (filter.marketplaceAccountId) {
      where.marketplaceAccountId = filter.marketplaceAccountId;
    }
    if (filter.marketplace) {
      where.marketplace = filter.marketplace;
    }

    return this.repository.find({ where, order: { startedAt: 'DESC' } });
  }
}
