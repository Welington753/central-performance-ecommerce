import { AccountScopeDeniedError } from './account-scope-denied.error';
import { AccountScopeService } from './account-scope.service';
import type { AccountScope } from './account-scope.types';

describe('AccountScopeService', () => {
  const service = new AccountScopeService();

  describe('isAccountAllowed', () => {
    it('ALL permite qualquer conta', () => {
      const scope: AccountScope = { mode: 'ALL' };
      expect(service.isAccountAllowed(scope, 'acc-1')).toBe(true);
      expect(service.isAccountAllowed(scope, 'acc-qualquer')).toBe(true);
    });

    it('SELECTED permite somente os IDs registrados', () => {
      const scope: AccountScope = {
        mode: 'SELECTED',
        accountIds: ['acc-1', 'acc-2'],
      };
      expect(service.isAccountAllowed(scope, 'acc-1')).toBe(true);
      expect(service.isAccountAllowed(scope, 'acc-3')).toBe(false);
    });

    it('SELECTED sem nenhum registro permite zero contas', () => {
      const scope: AccountScope = { mode: 'SELECTED', accountIds: [] };
      expect(service.isAccountAllowed(scope, 'acc-1')).toBe(false);
    });

    it('NONE permite zero contas', () => {
      const scope: AccountScope = { mode: 'NONE' };
      expect(service.isAccountAllowed(scope, 'acc-1')).toBe(false);
    });
  });

  describe('filterAllowedAccountIds', () => {
    it('nunca adiciona conta que não estava na lista original', () => {
      const scope: AccountScope = {
        mode: 'SELECTED',
        accountIds: ['acc-1', 'acc-9'],
      };
      const filtered = service.filterAllowedAccountIds(scope, [
        'acc-1',
        'acc-2',
        'acc-3',
      ]);
      expect(filtered).toEqual(['acc-1']);
      // "acc-9" está no escopo mas não na lista pedida — nunca aparece no resultado.
      expect(filtered).not.toContain('acc-9');
    });

    it('ALL devolve a lista original inteira, sem alterar ordem nem conteúdo', () => {
      const scope: AccountScope = { mode: 'ALL' };
      expect(
        service.filterAllowedAccountIds(scope, ['acc-3', 'acc-1']),
      ).toEqual(['acc-3', 'acc-1']);
    });

    it('NONE devolve lista vazia independentemente da entrada', () => {
      const scope: AccountScope = { mode: 'NONE' };
      expect(
        service.filterAllowedAccountIds(scope, ['acc-1', 'acc-2']),
      ).toEqual([]);
    });
  });

  describe('assertAccountAllowed', () => {
    it('não lança para conta permitida', () => {
      const scope: AccountScope = { mode: 'ALL' };
      expect(() => service.assertAccountAllowed(scope, 'acc-1')).not.toThrow();
    });

    it('lança AccountScopeDeniedError para conta proibida, com mensagem genérica (nunca confirma se a conta existe)', () => {
      const scope: AccountScope = { mode: 'NONE' };
      try {
        service.assertAccountAllowed(scope, 'acc-proibida');
        throw new Error('deveria ter lançado');
      } catch (error) {
        expect(error).toBeInstanceOf(AccountScopeDeniedError);
        expect((error as Error).message).not.toContain('acc-proibida');
        expect((error as Error).message).not.toMatch(
          /existe|not found|inexistente/i,
        );
      }
    });
  });

  describe('describeScope', () => {
    it('devolve a mesma representação discriminada recebida, sem perder informação', () => {
      const selected: AccountScope = {
        mode: 'SELECTED',
        accountIds: ['acc-1'],
      };
      expect(service.describeScope(selected)).toEqual(selected);
    });
  });
});
