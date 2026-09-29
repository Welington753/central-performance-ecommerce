import { validateClaimReasonResponseBody } from './mercado-livre-claim-reason-response';

describe('validateClaimReasonResponseBody', () => {
  it('aceita settings.rules_engine_triage como array, allowed_flows e expected_resolutions', () => {
    const result = validateClaimReasonResponseBody({
      flow: 'mediations',
      name: 'Produto não recebido',
      detail: 'Comprador alega não ter recebido',
      status: 'active',
      settings: { rules_engine_triage: ['auto_refund', 'manual_review'] },
      allowed_flows: ['mediations', 'cancel_purchase'],
      expected_resolutions: ['refund', 'replace'],
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.reason.triage).toEqual(['auto_refund', 'manual_review']);
    expect(result.reason.allowedFlows).toEqual([
      'mediations',
      'cancel_purchase',
    ]);
    expect(result.reason.expectedResolutions).toEqual(['refund', 'replace']);
  });

  it('detail ausente vira null; triage vazio quando settings ausente', () => {
    const result = validateClaimReasonResponseBody({
      flow: 'mediations',
      name: 'Produto danificado',
      status: 'active',
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.reason.detail).toBeNull();
    expect(result.reason.triage).toEqual([]);
    expect(result.reason.allowedFlows).toEqual([]);
    expect(result.reason.expectedResolutions).toEqual([]);
  });

  it('rejeita corpo sem flow/name/status', () => {
    expect(validateClaimReasonResponseBody({}).valid).toBe(false);
    expect(validateClaimReasonResponseBody(null).valid).toBe(false);
    expect(
      validateClaimReasonResponseBody({ flow: 'x', name: 'y' }).valid,
    ).toBe(false);
  });
});
