import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { User } from './user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  it('findByEmail queries the repository by email', async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: { findOne } },
      ],
    }).compile();
    const service = moduleRef.get(UsersService);

    await service.findByEmail('user@example.com');

    expect(findOne).toHaveBeenCalledWith({
      where: { email: 'user@example.com' },
    });
  });

  it('createUser persists a user with the given passwordHash (never the plain password)', async () => {
    const create = jest
      .fn()
      .mockImplementation((input: Partial<User>) => input);
    const save = jest
      .fn()
      .mockImplementation((input: Partial<User>) => Promise.resolve(input));
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: { create, save } },
      ],
    }).compile();
    const service = moduleRef.get(UsersService);

    await service.createUser({
      name: 'Ana',
      email: 'ana@example.com',
      passwordHash: 'argon2-hash-value',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        passwordHash: 'argon2-hash-value',
        active: true,
      }),
    );
    expect(save).toHaveBeenCalled();
  });
});
