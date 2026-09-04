/**
 * Allowlist estrita do corpo de `GET /shipments/{id}` (Fase 4, "Full") — o
 * único campo usado é `logistic_type`; nenhum outro dado do envio (endereço,
 * destinatário, transportadora etc.) é lido ou propagado.
 */
export interface RawMercadoLivreShipment {
  id: string;
  logisticType: string | null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function validateShipmentResponseBody(
  body: unknown,
): RawMercadoLivreShipment | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = body as Record<string, unknown>;

  const id = raw.id;
  if (!(typeof id === 'string' || typeof id === 'number')) return null;

  const logisticType = raw.logistic_type;
  return {
    id: String(id),
    logisticType: isNonEmptyString(logisticType) ? logisticType : null,
  };
}
