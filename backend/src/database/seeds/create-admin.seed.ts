import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as argon2 from 'argon2';
import { AppModule } from '../../app.module';
import { UsersService } from '../../users/users.service';

/**
 * Cadastro seguro do primeiro usuário admin.
 *
 * Uso: `npm run seed:admin`, com `INITIAL_ADMIN_EMAIL` e
 * `INITIAL_ADMIN_PASSWORD` definidos no ambiente (ex.: no `.env`).
 *
 * - Nunca imprime a senha no console (nem em texto puro, nem o hash).
 * - Falha com uma mensagem clara se as variáveis obrigatórias não estiverem
 *   definidas — não existe senha padrão.
 * - É idempotente: se o usuário já existir, não faz nada.
 */
async function bootstrap(): Promise<void> {
  const email = process.env.INITIAL_ADMIN_EMAIL;
  const password = process.env.INITIAL_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'INITIAL_ADMIN_EMAIL e INITIAL_ADMIN_PASSWORD são obrigatórias para criar o admin inicial. ' +
        'Defina ambas no ambiente antes de rodar "npm run seed:admin". Não há senha padrão.',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const usersService = app.get(UsersService);
    const existingUser = await usersService.findByEmail(email);

    if (existingUser) {
      console.log(
        `Usuário admin com email "${email}" já existe. Nenhuma ação necessária.`,
      );
      return;
    }

    const passwordHash = await argon2.hash(password);
    await usersService.createUser({
      name: 'Administrador',
      email,
      passwordHash,
    });

    console.log(`Usuário admin "${email}" criado com sucesso.`);
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  console.error(
    'Falha ao criar o usuário admin inicial:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
