import { Injectable } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { UserSession } from '../auth/user-session.entity';

/**
 * Revogação explícita de sessões (Checkpoint 3) — usada por desativação de
 * usuário, redefinição de senha administrativa e troca de senha pelo
 * próprio usuário. SEMPRE recebe um `EntityManager` de uma transação já
 * aberta pelo chamador (nunca abre a própria transação) — para participar
 * da MESMA transação da escrita que a motivou (ex.: desativar usuário +
 * revogar sessões commitam ou revertem juntos).
 *
 * Documentação de limite (design §8): revogar aqui marca `revoked_at`, o
 * que impede um FUTURO `POST /auth/refresh` para essas sessões — mas o
 * ACCESS TOKEN JWT já emitido continua válido até expirar (15 min por
 * padrão) em qualquer rota que use só `AccessTokenGuard`. `PermissionGuard`
 * já nega o usuário inativo na PRÓXIMA requisição (relê o banco a cada
 * chamada), mas rotas antigas que só têm `AccessTokenGuard` (a maioria,
 * ainda não migrada) não ganham essa garantia até o checkpoint de proteção
 * das rotas existentes. Isto NÃO é escondido — reafirmado aqui de propósito.
 */
@Injectable()
export class SessionRevocationService {
  async revokeAllActiveForUser(
    manager: EntityManager,
    userId: string,
  ): Promise<number> {
    const result = await manager
      .getRepository(UserSession)
      .update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
    return result.affected ?? 0;
  }
}
