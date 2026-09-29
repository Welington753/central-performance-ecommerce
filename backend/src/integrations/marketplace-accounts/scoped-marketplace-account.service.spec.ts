import { NotFoundException } from '@nestjs/common';
import { AccountScopeService } from '../../users/account-scope.service';
import { ACCOUNT_NOT_FOUND_MESSAGE } from './marketplace-accounts.service';
import { ScopedMarketplaceAccountService } from './scoped-marketplace-account.service';

describe('ScopedMarketplaceAccountService', () => {
  const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111';
  const FAKE_ACCOUNT = { id: ACCOUNT_ID } as never;

  function build(findByIdOrFail = jest.fn().mockResolvedValue(FAKE_ACCOUNT)) {
    const marketplaceAccountsService = { findByIdOrFail } as never;
    const service = new ScopedMarketplaceAccountService(
      marketplaceAccountsService,
      new AccountScopeService(),
    );
    return { service, findByIdOrFail };
  }

  it('ALL: consulta a conta normalmente e a devolve', async () => {
    const { service, findByIdOrFail } = build();

    const result = await service.assertAllowedAndFindOrFail(
      { mode: 'ALL' },
      ACCOUNT_ID,
    );

    expect(result).toBe(FAKE_ACCOUNT);
    expect(findByIdOrFail).toHaveBeenCalledWith(ACCOUNT_ID);
  });

  it('SELECTED com o id permitido: consulta a conta e a devolve', async () => {
    const { service, findByIdOrFail } = build();

    const result = await service.assertAllowedAndFindOrFail(
      { mode: 'SELECTED', accountIds: [ACCOUNT_ID] },
      ACCOUNT_ID,
    );

    expect(result).toBe(FAKE_ACCOUNT);
    expect(findByIdOrFail).toHaveBeenCalledWith(ACCOUNT_ID);
  });

  it('ALL com conta inexistente: propaga o 404 real de findByIdOrFail', async () => {
    const { service } = build(
      jest
        .fn()
        .mockRejectedValue(new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE)),
    );

    await expect(
      service.assertAllowedAndFindOrFail({ mode: 'ALL' }, ACCOUNT_ID),
    ).rejects.toMatchObject({ message: ACCOUNT_NOT_FOUND_MESSAGE });
  });

  describe('escopo nega — NUNCA consulta o banco (ordem crítica)', () => {
    it('NONE: 404 genérico sem chamar findByIdOrFail', async () => {
      const { service, findByIdOrFail } = build();

      await expect(
        service.assertAllowedAndFindOrFail({ mode: 'NONE' }, ACCOUNT_ID),
      ).rejects.toMatchObject({
        message: ACCOUNT_NOT_FOUND_MESSAGE,
        status: 404,
      });
      expect(findByIdOrFail).not.toHaveBeenCalled();
    });

    it('SELECTED vazio: 404 genérico sem chamar findByIdOrFail', async () => {
      const { service, findByIdOrFail } = build();

      await expect(
        service.assertAllowedAndFindOrFail(
          { mode: 'SELECTED', accountIds: [] },
          ACCOUNT_ID,
        ),
      ).rejects.toMatchObject({ message: ACCOUNT_NOT_FOUND_MESSAGE });
      expect(findByIdOrFail).not.toHaveBeenCalled();
    });

    it('SELECTED sem o id pedido: 404 genérico sem chamar findByIdOrFail', async () => {
      const { service, findByIdOrFail } = build();

      await expect(
        service.assertAllowedAndFindOrFail(
          {
            mode: 'SELECTED',
            accountIds: ['22222222-2222-2222-2222-222222222222'],
          },
          ACCOUNT_ID,
        ),
      ).rejects.toMatchObject({ message: ACCOUNT_NOT_FOUND_MESSAGE });
      expect(findByIdOrFail).not.toHaveBeenCalled();
    });
  });

  it('mensagem de "fora do escopo" é idêntica à de "conta inexistente" — nunca distinguível', async () => {
    const { service: deniedService } = build();
    const { service: missingService } = build(
      jest
        .fn()
        .mockRejectedValue(new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE)),
    );

    const deniedError = (await deniedService
      .assertAllowedAndFindOrFail({ mode: 'NONE' }, ACCOUNT_ID)
      .catch((e: unknown) => e)) as NotFoundException;
    const missingError = (await missingService
      .assertAllowedAndFindOrFail({ mode: 'ALL' }, ACCOUNT_ID)
      .catch((e: unknown) => e)) as NotFoundException;

    expect(deniedError).toBeInstanceOf(NotFoundException);
    expect(missingError).toBeInstanceOf(NotFoundException);
    expect(deniedError.message).toBe(missingError.message);
    expect(deniedError.getStatus()).toBe(missingError.getStatus());
  });
});
