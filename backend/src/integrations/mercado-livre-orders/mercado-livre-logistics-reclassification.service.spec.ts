import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { MercadoLivreLogisticsReclassificationService } from './mercado-livre-logistics-reclassification.service';
import { MercadoLivreShipmentLookupService } from './mercado-livre-shipment-lookup.service';
import { MercadoLivreOrderDetailLookupService } from './mercado-livre-order-detail-lookup.service';

const ML_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const SHOPEE_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

function account(
  overrides: Partial<MarketplaceAccount> = {},
): MarketplaceAccount {
  return {
    id: ML_ACCOUNT_ID,
    marketplace: Marketplace.MERCADO_LIVRE,
    externalSellerId: '111',
    nickname: 'Meli 1',
    status: MarketplaceAccountStatus.CONNECTED,
    errorSummary: null,
    failureCode: null,
    encryptedAccessToken: null,
    encryptedRefreshToken: null,
    encryptedCredentialMetadata: null,
    connectedByUserId: null,
    tokenVersion: 1,
    refreshFailureCount: 0,
    refreshRetryAt: null,
    lastRefreshAttemptAt: null,
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Fila em memória que imita a semântica real do repositório: o cursor por
 * `id`, o filtro `logistics_classification = 'UNKNOWN'` e a escrita
 * CONDICIONAL (que falha quando outro processo já resolveu a linha).
 */
function fakeRepository(
  rows: Array<{
    id: string;
    externalShipmentId: string;
    classification: string;
  }>,
) {
  const fetchPendingBatch = jest.fn(
    (input: { limit: number; afterId: string | null }) =>
      Promise.resolve(
        rows
          .filter((row) => row.classification === 'UNKNOWN')
          .filter((row) => input.afterId === null || row.id > input.afterId)
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, input.limit)
          .map((row) => ({
            id: row.id,
            externalShipmentId: row.externalShipmentId,
          })),
      ),
  );
  const applyResolvedClassification = jest.fn(
    (input: { orderId: string; classification: string }) => {
      const row = rows.find((candidate) => candidate.id === input.orderId);
      if (!row || row.classification !== 'UNKNOWN') {
        return Promise.resolve(false);
      }
      row.classification = input.classification;
      return Promise.resolve(true);
    },
  );
  return {
    rows,
    countPendingByAccount: jest.fn().mockResolvedValue([]),
    fetchPendingBatch,
    applyResolvedClassification,
    // Nenhum teste existente depende do fallback de recuperação: a fila
    // sem identificador vem sempre vazia por padrão (o comportamento
    // ORIGINAL do serviço permanece intocado por quem não sobrescrever).
    fetchPendingWithoutShipmentIdBatch: jest.fn().mockResolvedValue([]),
    attachRecoveredShipmentId: jest.fn().mockResolvedValue(true),
  };
}

function buildService(overrides: {
  accounts?: MarketplaceAccount[];
  repository?:
    | ReturnType<typeof fakeRepository>
    | ReturnType<typeof fakeRepositoryWithRecovery>;
  fetchShipment?: jest.Mock;
  fetchOrderShipmentId?: jest.Mock;
  ensureValidAccessToken?: jest.Mock;
  tryAcquire?: jest.Mock;
}) {
  const release = jest.fn().mockResolvedValue(undefined);
  const marketplaceAccountsService = {
    findAll: jest.fn().mockResolvedValue(overrides.accounts ?? [account()]),
  };
  const oauthService = {
    ensureValidAccessToken:
      overrides.ensureValidAccessToken ??
      jest.fn().mockResolvedValue('access-token'),
  };
  const fetchShipment =
    overrides.fetchShipment ??
    jest
      .fn()
      .mockResolvedValue({ kind: 'success', logisticType: 'fulfillment' });
  const configService = {
    get: (_key: string, fallback?: unknown) => fallback,
  } as unknown as ConfigService;
  const shipmentLookup = new MercadoLivreShipmentLookupService(
    { fetchShipment } as never,
    configService,
    () => Promise.resolve(),
  );
  // Nenhum teste existente insere pedido sem `external_shipment_id`, então o
  // fallback nunca é exercitado a menos que o teste passe sua própria fila
  // (`repository.fetchPendingWithoutShipmentIdBatch`) e um mock explícito.
  const fetchOrderShipmentId =
    overrides.fetchOrderShipmentId ??
    jest.fn().mockResolvedValue({ kind: 'not_found' });
  const orderDetailLookup = new MercadoLivreOrderDetailLookupService(
    { fetchOrderShipmentId } as never,
    configService,
    () => Promise.resolve(),
  );
  const repository = overrides.repository ?? fakeRepository([]);
  const advisoryLock = {
    tryAcquire:
      overrides.tryAcquire ?? jest.fn().mockResolvedValue({ release }),
  };

  const service = new MercadoLivreLogisticsReclassificationService(
    marketplaceAccountsService as never,
    oauthService as never,
    shipmentLookup,
    orderDetailLookup,
    repository as never,
    advisoryLock as never,
  );

  return {
    service,
    repository,
    fetchShipment,
    fetchOrderShipmentId,
    oauthService,
    advisoryLock,
    release,
  };
}

function pending(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `order-${String(index).padStart(3, '0')}`,
    externalShipmentId: `ship-${index}`,
    classification: 'UNKNOWN',
  }));
}

describe('MercadoLivreLogisticsReclassificationService.plan', () => {
  it('never calls the Mercado Livre API nor asks for a token — database only', async () => {
    const repository = fakeRepository([]);
    repository.countPendingByAccount.mockResolvedValue([
      {
        marketplaceAccountId: ML_ACCOUNT_ID,
        nickname: 'Meli 1',
        pendingWithShipmentId: 12,
        pendingWithoutShipmentId: 340,
        resolved: 900,
      },
    ]);
    const { service, fetchShipment, fetchOrderShipmentId, oauthService } =
      buildService({
        repository,
      });

    const report = await service.plan();

    expect(fetchShipment).not.toHaveBeenCalled();
    expect(fetchOrderShipmentId).not.toHaveBeenCalled();
    expect(oauthService.ensureValidAccessToken).not.toHaveBeenCalled();
    expect(
      repository.fetchPendingWithoutShipmentIdBatch,
    ).not.toHaveBeenCalled();
    expect(repository.countPendingByAccount).toHaveBeenCalledWith(
      Marketplace.MERCADO_LIVRE,
      null,
    );
    expect(report.batchSize).toBe(50);
    expect(report.accounts).toEqual([
      {
        nickname: 'Meli 1',
        pendingWithShipmentId: 12,
        pendingWithoutShipmentId: 340,
        resolved: 900,
        totalUnknown: 352,
        // Pessimista: 12 pedidos com id (1 chamada cada) + 340 sem id
        // (até 2 chamadas cada: detalhe do pedido + envio).
        estimatedMaxRequests: 12 + 340 * 2,
        estimatedBatches: Math.ceil(352 / 50),
      },
    ]);
    // O UUID da conta nunca é exposto no relatório operacional.
    expect(JSON.stringify(report)).not.toContain(ML_ACCOUNT_ID);
  });

  it('estimates the batch count using the batch size an operator provides', async () => {
    const repository = fakeRepository([]);
    repository.countPendingByAccount.mockResolvedValue([
      {
        marketplaceAccountId: ML_ACCOUNT_ID,
        nickname: 'Meli 1',
        pendingWithShipmentId: 100,
        pendingWithoutShipmentId: 0,
        resolved: 0,
      },
    ]);
    const { service } = buildService({ repository });

    const report = await service.plan(null, 25);

    expect(report.batchSize).toBe(25);
    expect(report.accounts[0].estimatedBatches).toBe(4);
  });
});

describe('MercadoLivreLogisticsReclassificationService.apply', () => {
  it('resolves pending orders and never touches an already resolved classification', async () => {
    const repository = fakeRepository([
      ...pending(2),
      {
        id: 'order-900',
        externalShipmentId: 'ship-900',
        classification: 'MARKETPLACE_FULFILLED',
      },
    ]);
    const { service, fetchShipment } = buildService({ repository });

    const [report] = await service.apply();

    expect(report.outcome).toBe('COMPLETED');
    expect(report.resolvedMarketplaceFulfilled).toBe(2);
    // A linha já resolvida nunca foi lida nem reescrita.
    expect(fetchShipment).toHaveBeenCalledTimes(2);
    expect(repository.applyResolvedClassification).not.toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-900' }),
    );
    expect(
      repository.rows.find((row) => row.id === 'order-900')?.classification,
    ).toBe('MARKETPLACE_FULFILLED');
  });

  it('never writes SELLER_FULFILLED for a failed lookup — the order stays UNKNOWN', async () => {
    const repository = fakeRepository(pending(1));
    const { service } = buildService({
      repository,
      fetchShipment: jest.fn().mockResolvedValue({ kind: 'not_found' }),
    });

    const [report] = await service.apply();

    expect(report.leftUnknownNotFound).toBe(1);
    expect(repository.applyResolvedClassification).not.toHaveBeenCalled();
    expect(repository.rows[0].classification).toBe('UNKNOWN');
  });

  it('leaves an unrecognised logistic_type as UNKNOWN instead of guessing', async () => {
    const repository = fakeRepository(pending(1));
    const { service } = buildService({
      repository,
      fetchShipment: jest.fn().mockResolvedValue({
        kind: 'success',
        logisticType: 'modalidade_nova_desconhecida',
      }),
    });

    const [report] = await service.apply();

    expect(report.leftUnknownUnrecognizedType).toBe(1);
    expect(repository.applyResolvedClassification).not.toHaveBeenCalled();
    expect(repository.rows[0].classification).toBe('UNKNOWN');
  });

  it('is resumable: stopping at the request cap preserves the work already committed', async () => {
    const repository = fakeRepository(pending(5));
    const { service } = buildService({ repository });

    const [first] = await service.apply({ maxRequestsPerAccount: 2 });

    expect(first.outcome).toBe('STOPPED_MAX_REQUESTS');
    expect(first.resolvedMarketplaceFulfilled).toBe(2);
    expect(
      repository.rows.filter((row) => row.classification === 'UNKNOWN'),
    ).toHaveLength(3);

    // Uma nova execução retoma exatamente de onde parou.
    const [second] = await service.apply({ maxRequestsPerAccount: 10 });
    expect(second.outcome).toBe('COMPLETED');
    expect(second.resolvedMarketplaceFulfilled).toBe(3);
    expect(
      repository.rows.every((row) => row.classification !== 'UNKNOWN'),
    ).toBe(true);
  });

  it('two runs in a row never corrupt data — the second finds nothing pending', async () => {
    const repository = fakeRepository(pending(3));
    const { service } = buildService({ repository });

    const [first] = await service.apply();
    const [second] = await service.apply();

    expect(first.resolvedMarketplaceFulfilled).toBe(3);
    expect(second.outcome).toBe('SKIPPED_NOTHING_PENDING');
    expect(second.ordersExamined).toBe(0);
    expect(second.shipmentRequests).toBe(0);
    expect(repository.rows.map((row) => row.classification)).toEqual([
      'MARKETPLACE_FULFILLED',
      'MARKETPLACE_FULFILLED',
      'MARKETPLACE_FULFILLED',
    ]);
  });

  it('counts a row resolved by another process between the read and the write, without overwriting it', async () => {
    const repository = fakeRepository(pending(1));
    // Simula a corrida: outro processo resolve a linha durante a consulta.
    repository.applyResolvedClassification.mockResolvedValueOnce(false);
    const { service } = buildService({ repository });

    const [report] = await service.apply();

    expect(report.skippedAlreadyResolved).toBe(1);
    expect(report.resolvedMarketplaceFulfilled).toBe(0);
  });

  it('aborts the batch on 401/403 instead of degrading many records', async () => {
    const repository = fakeRepository(pending(10));
    const { service, fetchShipment } = buildService({
      repository,
      fetchShipment: jest.fn().mockResolvedValue({ kind: 'unauthorized' }),
    });

    const [report] = await service.apply();

    expect(report.outcome).toBe('ABORTED_UNAUTHORIZED');
    // Uma única tentativa: nada de varrer a fila inteira com token inválido.
    expect(fetchShipment).toHaveBeenCalledTimes(1);
    expect(repository.applyResolvedClassification).not.toHaveBeenCalled();
  });

  it('ends resumably on a persistent 429 instead of burning the whole quota', async () => {
    const repository = fakeRepository(pending(10));
    const { service } = buildService({
      repository,
      fetchShipment: jest
        .fn()
        .mockResolvedValue({ kind: 'rate_limited', retryAfterMs: null }),
    });

    const [report] = await service.apply();

    expect(report.outcome).toBe('STOPPED_RATE_LIMITED');
    expect(
      repository.rows.every((row) => row.classification === 'UNKNOWN'),
    ).toBe(true);
  });

  it('ends resumably after repeated provider outages', async () => {
    const repository = fakeRepository(pending(20));
    const { service } = buildService({
      repository,
      fetchShipment: jest
        .fn()
        .mockResolvedValue({ kind: 'provider_unavailable' }),
    });

    const [report] = await service.apply();

    expect(report.outcome).toBe('STOPPED_PROVIDER_UNAVAILABLE');
    expect(report.ordersExamined).toBe(5);
  });

  it('never runs two reclassifiers on the same account — a busy lock skips it', async () => {
    const repository = fakeRepository(pending(3));
    const { service, fetchShipment, oauthService } = buildService({
      repository,
      tryAcquire: jest.fn().mockResolvedValue(null),
    });

    const [report] = await service.apply();

    expect(report.outcome).toBe('SKIPPED_ACCOUNT_BUSY');
    expect(oauthService.ensureValidAccessToken).not.toHaveBeenCalled();
    expect(fetchShipment).not.toHaveBeenCalled();
  });

  it('always releases the account lock, even when the batch aborts', async () => {
    const repository = fakeRepository(pending(1));
    const { service, release } = buildService({
      repository,
      fetchShipment: jest.fn().mockResolvedValue({ kind: 'unauthorized' }),
    });

    await service.apply();

    expect(release).toHaveBeenCalledTimes(1);
  });

  it('aborts the account without writing when a valid token cannot be obtained', async () => {
    const repository = fakeRepository(pending(3));
    const { service, fetchShipment, release } = buildService({
      repository,
      ensureValidAccessToken: jest
        .fn()
        .mockRejectedValue(new ConflictException('ACCOUNT_BUSY')),
    });

    const [report] = await service.apply();

    expect(report.outcome).toBe('ABORTED_TOKEN_UNAVAILABLE');
    expect(fetchShipment).not.toHaveBeenCalled();
    expect(repository.applyResolvedClassification).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('skips a disconnected account without any external call', async () => {
    const { service, fetchShipment, advisoryLock } = buildService({
      accounts: [account({ status: MarketplaceAccountStatus.ERROR })],
      repository: fakeRepository(pending(3)),
    });

    const [report] = await service.apply();

    expect(report.outcome).toBe('SKIPPED_NOT_CONNECTED');
    expect(advisoryLock.tryAcquire).not.toHaveBeenCalled();
    expect(fetchShipment).not.toHaveBeenCalled();
  });

  it('never touches a non Mercado Livre account', async () => {
    const { service, advisoryLock } = buildService({
      accounts: [
        account({ id: SHOPEE_ACCOUNT_ID, marketplace: Marketplace.SHOPEE }),
      ],
      repository: fakeRepository(pending(3)),
    });

    const reports = await service.apply();

    expect(reports).toEqual([]);
    expect(advisoryLock.tryAcquire).not.toHaveBeenCalled();
  });

  it('honours the account filter', async () => {
    const other = '33333333-3333-4333-8333-333333333333';
    const { service, advisoryLock } = buildService({
      accounts: [account(), account({ id: other, nickname: 'Meli 2' })],
      repository: fakeRepository([]),
    });

    await service.apply({ accountId: other });

    expect(advisoryLock.tryAcquire).toHaveBeenCalledTimes(1);
    expect(advisoryLock.tryAcquire).toHaveBeenCalledWith(other);
  });

  it('never leaks the access token, order ids or shipment ids into the report', async () => {
    const repository = fakeRepository(pending(2));
    const { service } = buildService({ repository });

    const reports = await service.apply();
    const serialized = JSON.stringify(reports);

    expect(serialized).not.toContain('access-token');
    expect(serialized).not.toContain('order-000');
    expect(serialized).not.toContain('ship-0');
  });
});

/**
 * Fila unificada para o fallback de recuperação (revisão crítica): uma
 * linha com `externalShipmentId: null` simula exatamente um pedido
 * histórico gravado antes da migration 1789000000000. As mesmas escritas
 * condicionais do repositório real (`attachRecoveredShipmentId`,
 * `applyResolvedClassification`) operam sobre o MESMO array.
 */
function fakeRepositoryWithRecovery(
  rows: Array<{
    id: string;
    externalOrderId: string;
    externalShipmentId: string | null;
    classification: string;
  }>,
) {
  const fetchPendingBatch = jest.fn(
    (input: { limit: number; afterId: string | null }) =>
      Promise.resolve(
        rows
          .filter(
            (row) =>
              row.classification === 'UNKNOWN' &&
              row.externalShipmentId !== null,
          )
          .filter((row) => input.afterId === null || row.id > input.afterId)
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, input.limit)
          .map((row) => ({
            id: row.id,
            externalShipmentId: row.externalShipmentId as string,
          })),
      ),
  );
  const fetchPendingWithoutShipmentIdBatch = jest.fn(
    (input: { limit: number; afterId: string | null }) =>
      Promise.resolve(
        rows
          .filter(
            (row) =>
              row.classification === 'UNKNOWN' &&
              row.externalShipmentId === null,
          )
          .filter((row) => input.afterId === null || row.id > input.afterId)
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, input.limit)
          .map((row) => ({ id: row.id, externalOrderId: row.externalOrderId })),
      ),
  );
  const attachRecoveredShipmentId = jest.fn(
    (input: { orderId: string; externalShipmentId: string }) => {
      const row = rows.find((candidate) => candidate.id === input.orderId);
      if (
        !row ||
        row.classification !== 'UNKNOWN' ||
        row.externalShipmentId !== null
      ) {
        return Promise.resolve(false);
      }
      row.externalShipmentId = input.externalShipmentId;
      return Promise.resolve(true);
    },
  );
  const applyResolvedClassification = jest.fn(
    (input: { orderId: string; classification: string }) => {
      const row = rows.find((candidate) => candidate.id === input.orderId);
      if (!row || row.classification !== 'UNKNOWN') {
        return Promise.resolve(false);
      }
      row.classification = input.classification;
      return Promise.resolve(true);
    },
  );
  return {
    rows,
    countPendingByAccount: jest.fn().mockResolvedValue([]),
    fetchPendingBatch,
    fetchPendingWithoutShipmentIdBatch,
    attachRecoveredShipmentId,
    applyResolvedClassification,
  };
}

function recoveryOrder(
  index: number,
  overrides: { externalShipmentId?: string | null } = {},
) {
  return {
    id: `hist-${String(index).padStart(3, '0')}`,
    externalOrderId: `ext-${index}`,
    externalShipmentId: overrides.externalShipmentId ?? null,
    classification: 'UNKNOWN',
  };
}

describe('MercadoLivreLogisticsReclassificationService — fallback de recuperação (revisão crítica)', () => {
  it('só roda depois que a fila direta (com shipment id) termina sem parada', async () => {
    const repository = fakeRepositoryWithRecovery([recoveryOrder(0)]);
    const fetchOrderShipmentId = jest
      .fn()
      .mockResolvedValue({ kind: 'success', shipmentId: 'recovered-ship-0' });
    const { service } = buildService({ repository, fetchOrderShipmentId });

    await service.apply();

    expect(repository.fetchPendingWithoutShipmentIdBatch).toHaveBeenCalled();
  });

  it('recupera o shipment id, persiste e consulta o envio na sequência — resolve a classificação', async () => {
    const repository = fakeRepositoryWithRecovery([recoveryOrder(0)]);
    const fetchOrderShipmentId = jest
      .fn()
      .mockResolvedValue({ kind: 'success', shipmentId: 'recovered-ship-0' });
    const fetchShipment = jest
      .fn()
      .mockResolvedValue({ kind: 'success', logisticType: 'fulfillment' });
    const { service } = buildService({
      repository,
      fetchOrderShipmentId,
      fetchShipment,
    });

    const [report] = await service.apply();

    expect(repository.attachRecoveredShipmentId).toHaveBeenCalledWith({
      orderId: 'hist-000',
      externalShipmentId: 'recovered-ship-0',
    });
    expect(fetchShipment).toHaveBeenCalledWith(
      'access-token',
      'recovered-ship-0',
    );
    expect(repository.rows[0].classification).toBe('MARKETPLACE_FULFILLED');
    expect(report.shipmentIdsRecovered).toBe(1);
    expect(report.orderDetailRequests).toBe(1);
    expect(report.resolvedMarketplaceFulfilled).toBe(1);
  });

  it('pedido sem envio associado (shipmentId nulo) permanece UNKNOWN sem nenhuma segunda chamada', async () => {
    const repository = fakeRepositoryWithRecovery([recoveryOrder(0)]);
    const fetchOrderShipmentId = jest
      .fn()
      .mockResolvedValue({ kind: 'success', shipmentId: null });
    const fetchShipment = jest.fn();
    const { service } = buildService({
      repository,
      fetchOrderShipmentId,
      fetchShipment,
    });

    await service.apply();

    expect(fetchShipment).not.toHaveBeenCalled();
    expect(repository.attachRecoveredShipmentId).not.toHaveBeenCalled();
    expect(repository.rows[0].classification).toBe('UNKNOWN');
  });

  it('GET /orders/{id} 404 deixa o pedido UNKNOWN, contado separadamente do 404 de envio', async () => {
    const repository = fakeRepositoryWithRecovery([recoveryOrder(0)]);
    const fetchOrderShipmentId = jest
      .fn()
      .mockResolvedValue({ kind: 'not_found' });
    const { service } = buildService({ repository, fetchOrderShipmentId });

    const [report] = await service.apply();

    expect(report.leftUnknownOrderNotFound).toBe(1);
    expect(report.leftUnknownNotFound).toBe(0);
    expect(repository.rows[0].classification).toBe('UNKNOWN');
  });

  it('401/403 na consulta de detalhe do pedido ABORTA o lote, nunca degrada registros', async () => {
    const repository = fakeRepositoryWithRecovery([
      recoveryOrder(0),
      recoveryOrder(1),
    ]);
    const fetchOrderShipmentId = jest
      .fn()
      .mockResolvedValue({ kind: 'unauthorized' });
    const { service } = buildService({ repository, fetchOrderShipmentId });

    const [report] = await service.apply();

    expect(report.outcome).toBe('ABORTED_UNAUTHORIZED');
    expect(fetchOrderShipmentId).toHaveBeenCalledTimes(1);
  });

  it('429 persistente na consulta de detalhe encerra de forma retomável (sem estourar o orçamento)', async () => {
    const repository = fakeRepositoryWithRecovery([
      recoveryOrder(0),
      recoveryOrder(1),
    ]);
    const fetchOrderShipmentId = jest
      .fn()
      .mockResolvedValue({ kind: 'rate_limited', retryAfterMs: null });
    const { service } = buildService({ repository, fetchOrderShipmentId });

    const [report] = await service.apply();

    expect(report.outcome).toBe('STOPPED_RATE_LIMITED');
  });

  it('as duas filas dividem o MESMO orçamento de requisições', async () => {
    const repository = fakeRepositoryWithRecovery([
      {
        id: 'a-000',
        externalShipmentId: 'ship-a',
        classification: 'UNKNOWN',
        externalOrderId: 'ext-a',
      },
      recoveryOrder(0),
    ]);
    const fetchShipment = jest
      .fn()
      .mockResolvedValue({ kind: 'success', logisticType: 'fulfillment' });
    const fetchOrderShipmentId = jest.fn();
    const { service } = buildService({
      repository,
      fetchShipment,
      fetchOrderShipmentId,
      // maxRequestsPerAccount é passado via apply() abaixo.
    });

    const [report] = await service.apply({ maxRequestsPerAccount: 1 });

    // O orçamento (1) já foi consumido pela fila direta — a fila de
    // recuperação nunca chega a rodar.
    expect(report.shipmentRequests).toBe(1);
    expect(fetchOrderShipmentId).not.toHaveBeenCalled();
    expect(report.outcome).toBe('STOPPED_MAX_REQUESTS');
  });

  it('nunca sobrescreve um external_shipment_id já persistido por outro processo concorrente', async () => {
    const repository = fakeRepositoryWithRecovery([recoveryOrder(0)]);
    // Simula outro processo preenchendo a linha ENTRE a leitura e a escrita.
    repository.attachRecoveredShipmentId.mockImplementationOnce(() =>
      Promise.resolve(false),
    );
    const fetchOrderShipmentId = jest
      .fn()
      .mockResolvedValue({ kind: 'success', shipmentId: 'recovered-ship-0' });
    const fetchShipment = jest.fn();
    const { service } = buildService({
      repository,
      fetchOrderShipmentId,
      fetchShipment,
    });

    const [report] = await service.apply();

    expect(fetchShipment).not.toHaveBeenCalled();
    expect(report.skippedAlreadyResolved).toBe(1);
    expect(report.shipmentIdsRecovered).toBe(0);
  });

  it('é resumível: o cursor da fila de recuperação avança mesmo sem sucesso, sem laço infinito', async () => {
    const repository = fakeRepositoryWithRecovery([
      recoveryOrder(0),
      recoveryOrder(1),
    ]);
    const fetchOrderShipmentId = jest
      .fn()
      .mockResolvedValue({ kind: 'not_found' });
    const { service } = buildService({ repository, fetchOrderShipmentId });

    await service.apply();

    expect(fetchOrderShipmentId).toHaveBeenCalledTimes(2);
    expect(
      repository.fetchPendingWithoutShipmentIdBatch,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({ afterId: 'hist-001' }),
    );
  });
});
