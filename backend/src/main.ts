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
  await app.listen(port);
  Logger.log(
    `Aplicação rodando na porta ${port} (NODE_ENV=${nodeEnv})`,
    'Bootstrap',
  );
}

void bootstrap();
