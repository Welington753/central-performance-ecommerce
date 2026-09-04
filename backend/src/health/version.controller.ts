import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VersionService } from './version.service';
import type { VersionInfo } from './version.service';

/**
 * Endpoint público e sanitizado (design "/version") para identificar o
 * artefato REALMENTE em execução — nunca caminho local, branch, variáveis
 * de ambiente, hostname, PID, tokens ou segredos. Existe para nunca mais
 * repetir o incidente em que `/health` respondia 200 com um processo
 * `node dist/main` antigo, sem nenhum jeito de saber qual build estava
 * rodando de fato.
 */
@ApiTags('health')
@Controller('version')
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  @Get()
  getVersion(): VersionInfo {
    return this.versionService.getInfo();
  }
}
