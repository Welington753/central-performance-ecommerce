import { classifyLogisticType } from './mercado-livre-logistics.util';

describe('classifyLogisticType', () => {
  it('classifies "fulfillment" as MARKETPLACE_FULFILLED (Full)', () => {
    expect(classifyLogisticType('fulfillment')).toBe('MARKETPLACE_FULFILLED');
  });

  it.each(['drop_off', 'cross_docking', 'self_service', 'xd_drop_off'])(
    'classifies "%s" as SELLER_FULFILLED — never Full',
    (logisticType) => {
      expect(classifyLogisticType(logisticType)).toBe('SELLER_FULFILLED');
    },
  );

  it('never classifies Flex (self_service) as Full', () => {
    expect(classifyLogisticType('self_service')).not.toBe(
      'MARKETPLACE_FULFILLED',
    );
  });

  it('classifies null as UNKNOWN', () => {
    expect(classifyLogisticType(null)).toBe('UNKNOWN');
  });

  it('classifies an unrecognized value as UNKNOWN, never inferring SELLER_FULFILLED', () => {
    expect(classifyLogisticType('some_new_future_type')).toBe('UNKNOWN');
  });
});
