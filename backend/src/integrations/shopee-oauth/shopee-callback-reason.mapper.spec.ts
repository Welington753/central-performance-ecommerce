import { mapShopeeCallbackOutcomeToPublicReason } from './shopee-callback-reason.mapper';

describe('mapShopeeCallbackOutcomeToPublicReason', () => {
  it.each`
    kind                   | expectedReason
    ${'invalid_callback'}  | ${'OAUTH_CALLBACK_INVALID'}
    ${'connection_failed'} | ${'CONNECTION_FAILED'}
    ${'lock_unavailable'}  | ${'CONNECTION_BUSY'}
  `(
    'mapeia $kind para $expectedReason',
    ({
      kind,
      expectedReason,
    }: {
      kind: 'invalid_callback' | 'connection_failed' | 'lock_unavailable';
      expectedReason: string;
    }) => {
      expect(mapShopeeCallbackOutcomeToPublicReason(kind)).toBe(expectedReason);
    },
  );
});
