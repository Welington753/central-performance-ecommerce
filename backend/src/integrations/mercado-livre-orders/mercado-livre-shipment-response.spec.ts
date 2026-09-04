import { validateShipmentResponseBody } from './mercado-livre-shipment-response';

describe('validateShipmentResponseBody', () => {
  it('extracts id and logistic_type, ignoring every other field', () => {
    const result = validateShipmentResponseBody({
      id: 123,
      logistic_type: 'fulfillment',
      receiver_address: { street_name: 'Rua X', receiver_name: 'Fulano' },
    });
    expect(result).toEqual({ id: '123', logisticType: 'fulfillment' });
  });

  it('never leaks any other field into the validated result', () => {
    const result = validateShipmentResponseBody({
      id: 1,
      logistic_type: 'drop_off',
      receiver_address: { receiver_name: 'Fulano' },
    });
    expect(JSON.stringify(result)).not.toContain('Fulano');
  });

  it('defaults logisticType to null when absent', () => {
    const result = validateShipmentResponseBody({ id: 1 });
    expect(result).toEqual({ id: '1', logisticType: null });
  });

  it.each([
    ['body not an object', 'not-an-object'],
    ['body null', null],
    ['missing id', { logistic_type: 'fulfillment' }],
  ])('rejects when %s', (_label, body) => {
    expect(validateShipmentResponseBody(body)).toBeNull();
  });
});
