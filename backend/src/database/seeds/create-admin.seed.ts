import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import type { Repository } from 'typeorm';
import { AppModule } from '../../app.module';
import { AccountScopeMode } from '../../users/account-scope-mode.enum';
import { ROLE_KEYS } from '../../users/permissions.catalog';
import { Role } from '../../users/role.entity';
import { UsersService } from '../../users/users.service';

export interface CreateAdminSeedEnv {
  email: string | undefined;
  password: string | undefined;
}

export type CreateAdminSeedOutcome =
  { outcome: 'created' } | { outcome: 'already_exists' };

/**
 * Lógica pura do seed, testável sem subir um `NestApplicationContext` real
 * — recebe `UsersService`/`Repository<Role>` já resolvidos. Nunca promove
 * um usuário existente (ver nota em `runCreateAdminSeed` abaixo): mudar o
 * papel de alguém já cadastrado é decisão administrativa explícita (via
 * `PATCH /users/:id`, Checkpoint 3), nunca efeito colateral de rodar o
 * seed — evita elevar privilégio de outra conta ao reexecutar com um
 * e-mail reciclado/digitado errado.
 */
export async function runCreateAdminSeed(
  usersService: UsersService,
  roleRepository: Repository<Role>,
  env: CreateAdminSeedEnv,
): Promise<CreateAdminSeedOutcome> {
  const { email, password } = env;
  if (!email || !password) {
    throw new Error(
      'INITIAL_ADMIN_EMAIL e INITIAL_ADMIN_PASSWORD são obrigatórias para criar o admin inicial. ' +
        'Defina ambas no ambiente antes de rodar "npm run seed:admin". Não há senha padrão.',
    );
  }

  const existingUser = await usersService.findByEmail(email);
  if (existingUser) {
    return { outcome: 'already_exists' };
  }

  const adminRole = await roleRepository.findOneBy({ key: ROLE_KEYS.ADMIN });
  if (!adminRole) {
    throw new Error(
      'Papel ADMIN não encontrado em "roles" — rode as migrations (npm run migration:run) antes do seed.',
    );
  }

  const passwordHash = await argon2.hash(password);
  await usersService.createUser({
    name: 'Administrador',
    email,
    passwordHash,
    roleId: adminRole.id,
    isAdmin: true,
    accountScopeMode: AccountScopeMode.ALL,
    // Senha escolhida conscientemente via variável de ambiente — não é uma
    // senha temporária que precise de troca no primeiro acesso.
    mustChangePassword: false,
  });

  return { outcome: 'created' };
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const usersService = app.get(UsersService);
    const roleRepository = app.get<Repository<Role>>(getRepositoryToken(Role));
    const email = process.env.INITIAL_ADMIN_EMAIL;

    const result = await runCreateAdminSeed(usersService, roleRepository, {
      email,
      password: process.env.INITIAL_ADMIN_PASSWORD,
    });

    if (result.outcome === 'already_exists') {
      console.log(
        `Usuário com email "${email}" já existe — seed não altera papel nem senha de usuário existente. Nenhuma ação necessária.`,
      );
    } else {
      console.log(`Usuário admin "${email}" criado com sucesso.`);
    }
  } finally {
    await app.close();
  }
}

// Guarda o auto-run: este arquivo é importável (pelos testes) sem disparar
// `bootstrap()` como efeito colateral — só executa de verdade quando é o
// próprio entrypoint do processo (`npm run seed:admin`).
if (require.main === module) {
  bootstrap().catch((error: unknown) => {
    console.error(
      'Falha ao criar o usuário admin inicial:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  });
}
