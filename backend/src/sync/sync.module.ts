import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { SyncRun } from './sync-run.entity';
import { SyncRunsController } from './sync-runs.controller';
import { SyncRunsService } from './sync-runs.service';

@Module({
  imports: [TypeOrmModule.forFeature([SyncRun]), AuthModule],
  controllers: [SyncRunsController],
  providers: [SyncRunsService],
  exports: [SyncRunsService],
})
export class SyncModule {}
