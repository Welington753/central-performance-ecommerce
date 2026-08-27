import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

/**
 * `/health` verifica apenas a conectividade com o próprio banco de dados
 * (ping simples via TypeORM). Nenhuma chamada externa (marketplace, etc.) é
 * feita aqui — isso é proibido nesta fase.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthCheckService: HealthCheckService,
    private readonly databaseHealthIndicator: TypeOrmHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.healthCheckService.check([
      () => this.databaseHealthIndicator.pingCheck('database'),
    ]);
  }
}
