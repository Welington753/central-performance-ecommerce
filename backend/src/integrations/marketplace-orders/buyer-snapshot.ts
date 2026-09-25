export type BuyerDataSource = 'MERCADO_LIVRE_ORDERS' | 'SHOPEE_ORDER_DETAIL';

/**
 * `buyerName`: nome do COMPRADOR (Mercado Livre). `recipientName`/
 * `recipientPhone`: nome/telefone do DESTINATÁRIO da entrega (Shopee,
 * `recipient_address`) — pode ser outra pessoa, nunca apresentado como dado
 * do comprador. `city`/`state`/`postalCode`: endereço de ENTREGA.
 */
export const BUYER_PERSONAL_FIELDS = [
  'username',
  'buyerName',
  'recipientName',
  'email',
  'recipientPhone',
  'city',
  'state',
  'postalCode',
] as const;

export type BuyerPersonalField = (typeof BUYER_PERSONAL_FIELDS)[number];

/** Campos pessoais em texto claro (só em memória — persistidos criptografados quando sensíveis). */
export type BuyerPersonalData = Record<BuyerPersonalField, string | null>;

/**
 * Comprador extraído de UM pedido já validado — só campos da allowlist do
 * respectivo parser, nunca payload bruto. `null` = a fonte não trouxe o
 * campo nesta resposta (nunca "apagar").
 */
export interface MappedBuyerRecord extends BuyerPersonalData {
  externalBuyerId: string;
  dataSource: BuyerDataSource;
}

export interface StoredBuyerSnapshot {
  data: BuyerPersonalData;
  personalDataLastUpdatedAt: Date | null;
}

/** Shopee (e eventualmente outros) devolve dados pessoais mascarados com `*`. */
export function isMaskedValue(value: string | null): boolean {
  return value !== null && value.includes('*');
}

/** Presente e não mascarado pela fonte — o único valor que conta como "disponível". */
export function isUsableValue(value: string | null): value is string {
  return value !== null && !isMaskedValue(value);
}

export function emptyBuyerPersonalData(): BuyerPersonalData {
  return {
    username: null,
    buyerName: null,
    recipientName: null,
    email: null,
    recipientPhone: null,
    city: null,
    state: null,
    postalCode: null,
  };
}

/**
 * Merge determinístico de um snapshot recebido sobre o já persistido:
 * - `null` recebido nunca apaga valor existente;
 * - evento mais antigo que `personalDataLastUpdatedAt` só preenche lacunas,
 *   nunca sobrescreve;
 * - valor mascarado nunca substitui um valor não mascarado.
 */
export function mergeBuyerSnapshot(
  stored: StoredBuyerSnapshot,
  incoming: BuyerPersonalData,
  observedAt: Date,
): { snapshot: StoredBuyerSnapshot; changed: boolean } {
  const storedAt = stored.personalDataLastUpdatedAt;
  const isNewerOrEqual =
    storedAt === null || observedAt.getTime() >= storedAt.getTime();

  const data = { ...stored.data };
  let changed = false;
  let receivedAny = false;

  for (const field of BUYER_PERSONAL_FIELDS) {
    const next = incoming[field];
    if (next === null) continue;
    receivedAny = true;
    const current = data[field];
    if (current === next) continue;
    const accept =
      current === null ||
      (isNewerOrEqual && !(isMaskedValue(next) && !isMaskedValue(current)));
    if (accept) {
      data[field] = next;
      changed = true;
    }
  }

  const personalDataLastUpdatedAt =
    receivedAny && isNewerOrEqual ? observedAt : storedAt;
  if (
    (personalDataLastUpdatedAt?.getTime() ?? null) !==
    (storedAt?.getTime() ?? null)
  ) {
    changed = true;
  }

  return { snapshot: { data, personalDataLastUpdatedAt }, changed };
}
