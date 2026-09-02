import { ConfigService } from '@nestjs/config';
import { loadAmazonMarketplaceIds } from './amazon-marketplace-ids.util';

function configServiceWith(value: string | undefined): ConfigService {
  return {
    get: () => value,
  } as unknown as ConfigService;
}

describe('loadAmazonMarketplaceIds', () => {
  it('splits and trims a comma-separated list', () => {
    expect(
      loadAmazonMarketplaceIds(configServiceWith('A2Q3Y263D00KWC, ABC123')),
    ).toEqual(['A2Q3Y263D00KWC', 'ABC123']);
  });

  it('returns null when the variable is absent', () => {
    expect(loadAmazonMarketplaceIds(configServiceWith(undefined))).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(loadAmazonMarketplaceIds(configServiceWith(''))).toBeNull();
  });

  it('drops empty entries from trailing/double commas', () => {
    expect(loadAmazonMarketplaceIds(configServiceWith('A,,B,'))).toEqual([
      'A',
      'B',
    ]);
  });

  it('never throws', () => {
    expect(() =>
      loadAmazonMarketplaceIds(configServiceWith(undefined)),
    ).not.toThrow();
  });
});
