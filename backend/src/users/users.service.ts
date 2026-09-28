import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountScopeMode } from './account-scope-mode.enum';
import { User } from './user.entity';

/**
 * `roleId`/`accountScopeMode`/`isAdmin`/`mustChangePassword` são
 * obrigatórios desde o Checkpoint 3 — `role_id` é NOT NULL no banco, e todo
 * caminho de criação (seed, `UsersManagementService.create`) é forçado a
 * decidir papel e escopo conscientemente, nunca herdar um default implícito
 * aqui.
 */
export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
  roleId: string;
  isAdmin: boolean;
  accountScopeMode: AccountScopeMode;
  mustChangePassword: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.repository.findOne({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.repository.findOne({ where: { id } });
  }

  async createUser(input: CreateUserInput): Promise<User> {
    const user = this.repository.create({
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash,
      active: true,
      roleId: input.roleId,
      isAdmin: input.isAdmin,
      accountScopeMode: input.accountScopeMode,
      mustChangePassword: input.mustChangePassword,
    });
    return this.repository.save(user);
  }
}
