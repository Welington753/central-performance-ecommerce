import { Marketplace } from '../../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-account.entity';
import { toMarketplaceAccountResponse } from './marketplace-account-response.dto';

describe('toMarketplaceAccountResponse', () => {
  it('never includes encrypted columns, connectedByUserId, tokenVersion, failureCode or errorSummary (design §7: internal/auditoria only)', () => {
    const account: MarketplaceAccount = {
      id: 'acc-1',
      marketplace: Marketplace.MERCADO_LIVRE,
      externalSellerId: '123',
      nickname: 'Loja principal',
      status: MarketplaceAccountStatus.ERROR,
      errorSummary:
        'Esta conta do Mercado Livre já está conectada em outro registro.',
      failureCode: 'ACCOUNT_ALREADY_CONNECTED',
      encryptedAccessToken: 'iv:tag:cipher-access',
      encryptedRefreshToken: 'iv:tag:cipher-refresh',
      encryptedCredentialMetadata: null,
      connectedByUserId: 'user-1',
      tokenVersion: 4,
      tokenExpiresAt: new Date('2026-08-27T12:00:00.000Z'),
      lastSuccessfulSyncAt: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    };

    const dto = toMarketplaceAccountResponse(account);
    const serialized = JSON.stringify(dto);

    expect(serialized).not.toContain('cipher-access');
    expect(serialized).not.toContain('cipher-refresh');
    expect(serialized).not.toContain('ACCOUNT_ALREADY_CONNECTED');
    expect(serialized).not.toContain('já está conectada em outro registro');
    expect(dto).not.toHaveProperty('encryptedAccessToken');
    expect(dto).not.toHaveProperty('encryptedRefreshToken');
    expect(dto).not.toHaveProperty('encryptedCredentialMetadata');
    expect(dto).not.toHaveProperty('connectedByUserId');
    expect(dto).not.toHaveProperty('tokenVersion');
    expect(dto).not.toHaveProperty('failureCode');
    expect(dto).not.toHaveProperty('errorSummary');
    expect(dto.status).toBe('ERROR'); // status É público — o frontend deriva sua própria mensagem fixa a partir dele
    expect(dto.tokenExpiresAt).toBe('2026-08-27T12:00:00.000Z');
  });
});
