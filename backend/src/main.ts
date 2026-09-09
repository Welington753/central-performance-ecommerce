import {
  ClassSerializerInterceptor,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { LoggingInterceptor } from './common/logging/logging.interceptor';
import { VersionService } from './health/version.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService);

  app.use(helmet());
  app.use(cookieParser());

  app.enableCors({
    origin: configService.getOrThrow<string>('FRONTEND_URL'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new ClassSerializerInterceptor(app.get(Reflector)),
  );

  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const enableSwaggerFlag = configService.get<string>('ENABLE_SWAGGER');
  const swaggerEnabled = enableSwaggerFlag
    ? enableSwaggerFlag === 'true'
    : nodeEnv !== 'production';

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Central de Performance — API')
      .setDescription(
        'Fundação multi-marketplace (Fase 1). Nenhuma integração externa real está implementada nesta fase.',
      )
      .setVersion('0.0.1')
      .addCookieAuth('access_token')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  const port = configService.get<number>('PORT', 3000);
  // Sem `APP_HOST` definido: `127.0.0.1` fora de produção (nunca expor a
  // rede local sem decisão explícita), `0.0.0.0` em produção (comportamento
  // padrão de container, onde a variável tipicamente não é setada).
  const host = configService.get<string>(
    'APP_HOST',
    nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1',
  );
  await app.listen(port, host);
  Logger.log(
    `Aplicação rodando em ${host}:${port} (NODE_ENV=${nodeEnv})`,
    'Bootstrap',
  );

  // Uma única linha sanitizada com o artefato REALMENTE em execução (design
  // "/version") — nunca segredo/caminho/hostname/PID, só o que já é público
  // em GET /version.
  const { commit, builtAt, startedAt } = app.get(VersionService).getInfo();
  Logger.log(
    `Versão em execução: commit=${commit} builtAt=${builtAt ?? 'null'} startedAt=${startedAt}`,
    'Bootstrap',
  );
}

void bootstrap();
