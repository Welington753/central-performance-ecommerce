import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { VersionController } from './version.controller';
import { VersionService } from './version.service';
import { BUILD_INFO, PACKAGE_VERSION } from './version.tokens';
import {
  loadBuildInfo,
  readPackageVersion,
  resolveDistDir,
} from './build-info.util';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController, VersionController],
  providers: [
    VersionService,
    {
      // Resolvido UMA vez no bootstrap (fábrica de provider singleton) —
      // nunca por request, nunca chama `git` (só lê o arquivo gerado no
      // build).
      provide: BUILD_INFO,
      useFactory: () => loadBuildInfo(resolveDistDir()),
    },
    {
      provide: PACKAGE_VERSION,
      useFactory: () => readPackageVersion(resolveDistDir()),
    },
  ],
  exports: [VersionService],
})
export class HealthModule {}
