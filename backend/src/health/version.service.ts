import { Inject, Injectable } from '@nestjs/common';
import { BUILD_INFO, PACKAGE_VERSION } from './version.tokens';
import type { BuildInfo } from './build-info.util';

export interface VersionInfo {
  service: string;
  version: string;
  commit: string;
  builtAt: string | null;
  startedAt: string;
}

const SERVICE_NAME = 'central-performance-backend';

/**
 * `startedAt` é capturado UMA vez, na construção (singleton — Nest instancia
 * uma única vez por processo): muda só quando o processo reinicia, nunca a
 * cada request. `commit`/`version` vêm injetados já resolvidos no bootstrap
 * (ver `version.module.ts`) — nunca recalculados aqui.
 */
@Injectable()
export class VersionService {
  private readonly startedAt = new Date().toISOString();

  constructor(
    @Inject(BUILD_INFO) private readonly buildInfo: BuildInfo,
    @Inject(PACKAGE_VERSION) private readonly version: string,
  ) {}

  getInfo(): VersionInfo {
    return {
      service: SERVICE_NAME,
      version: this.version,
      commit: this.buildInfo.commit,
      builtAt: this.buildInfo.builtAt,
      startedAt: this.startedAt,
    };
  }
}
