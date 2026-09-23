import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
import { MarketplaceOrderItem } from '../marketplace-orders/marketplace-order-item.entity';
import { LogisticsReclassificationRepository } from '../marketplace-orders/logistics-reclassification.repository';
import { AdvisoryLockService } from '../shared/advisory-lock.service';
import { MercadoLivreLogisticsReclassificationService } from './mercado-livre-logistics-reclassification.service';

function fakeLockConfigService(): ConfigService {
  return {
    get: (_key: string, fallback?: unknown) => fallback,
  } as unknown as ConfigService;
}

/**
 * Revisão crítica pós-implementação (item 3, "lease e execução demorada"):
 * o lease do worker (120s por padrão) protege contra dois WORKERS
 * reivindicando o mesmo job, mas NUNCA foi a barreira contra duas chamadas
 * HTTP simultâneas para a MESMA conta — essa barreira SEMPRE foi o advisory
 * lock do Postgres já existente dentro de
 * `MercadoLivreLogisticsReclassificationService.applyForAccount`
 * (`pg_try_advisory_lock`, reaproveitado sem cópia). Esta suíte prova isso
 * contra um Postgres REAL: uma chamada `apply()` LENTA (presa numa consulta
 * de envio que só resolve quando o teste manda) mantém o lock adquirido;
 * uma SEGUNDA chamada `apply()` concorrente para a MESMA conta — o cenário
 * exato de um lease de job expirado no meio de um tick lento — nunca chega
 * a fazer nenhuma chamada HTTP: falha imediatamente com
 * `SKIPPED_ACCOUNT_BUSY`.
 */
describe('MercadoLivreLogisticsReclassificationService — advisory lock contra lease expirado em chamada lenta (Postgres real)', () => {
  let dataSource: DataSource;
  let accountId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      MarketplaceAccount,
      MarketplaceOrder,
      MarketplaceOrderItem,
    ]);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE marketplace_order_items CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_orders CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');

    const account = await dataSource.getRepository(MarketplaceAccount).save({
      id: randomUUID(),
      marketplace: Marketplace.MERCADO_LIVRE,
      externalSellerId: '1548451374',
      nickname: 'Meli 1',
      status: MarketplaceAccountStatus.CONNECTED,
      tokenVersion: 1,
    });
    accountId = account.id;

    await dataSource.getRepository(MarketplaceOrder).save({
      id: randomUUID(),
      marketplaceAccountId: accountId,
      externalOrderId: 'order-1',
      status: 'paid',
      currencyId: 'BRL',
      totalAmount: '100.00',
      packId: null,
      dateCreated: new Date('2026-01-01T00:00:00Z'),
      dateClosed: null,
      marketplaceLastUpdated: new Date('2026-01-01T00:00:00Z'),
      sourceStatus: null,
      fulfillmentChannel: null,
      externalMarketplaceId: null,
      logisticsClassification: 'UNKNOWN',
      logisticsType: null,
      externalShipmentId: 'shipment-1',
    });
  });

  function buildService(shipmentLookupDelay: {
    lookup: (token: string, shipmentId: string) => Promise<unknown>;
  }) {
    const marketplaceAccountsService = {
      findAll: () =>
        Promise.resolve([
          {
            id: accountId,
            nickname: 'Meli 1',
            status: MarketplaceAccountStatus.CONNECTED,
            marketplace: Marketplace.MERCADO_LIVRE,
          },
        ]),
    };
    const oauthService = {
      ensureValidAccessToken: () => Promise.resolve('fake-token'),
    };
    const orderDetailLookup = {
      lookup: () => Promise.resolve({ kind: 'not_found' }),
    };
    const repository = new LogisticsReclassificationRepository(dataSource);
    const advisoryLock = new AdvisoryLockService(
      dataSource,
      fakeLockConfigService(),
    );

    return new MercadoLivreLogisticsReclassificationService(
      marketplaceAccountsService as never,
      oauthService as never,
      shipmentLookupDelay as never,
      orderDetailLookup as never,
      repository,
      advisoryLock,
    );
  }

  it('a second apply() call for the same account never makes an HTTP call while the first is still in flight (SKIPPED_ACCOUNT_BUSY instead)', async () => {
    let resolveFirstLookup!: (value: unknown) => void;
    const firstLookupPending = new Promise((resolve) => {
      resolveFirstLookup = resolve;
    });
    const lookupCalls: string[] = [];
    const shipmentLookup = {
      lookup: (_token: string, shipmentId: string) => {
        lookupCalls.push(shipmentId);
        return firstLookupPending;
      },
    };
    const service = buildService(shipmentLookup);

    // Worker A: chamada LENTA, presa na consulta de envio — nunca await
    // aqui, simula o tick que estouraria o lease de 120s.
    const applyAPromise = service.apply({
      accountId,
      maxRequestsPerAccount: 10,
    });

    // Dá tempo do lock ser adquirido de verdade antes da segunda chamada.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Worker B: mesma conta, EM PARALELO — o cenário real de dois workers
    // (ou o mesmo worker após "perder" o job por lease expirado) tentando
    // processar a mesma conta ao mesmo tempo.
    const reportsB = await service.apply({
      accountId,
      maxRequestsPerAccount: 10,
    });

    expect(reportsB[0].outcome).toBe('SKIPPED_ACCOUNT_BUSY');
    // A segunda chamada NUNCA fez nenhuma requisição HTTP — só UMA consulta
    // de envio (a da chamada A, ainda presa) existe até aqui.
    expect(lookupCalls).toHaveLength(1);

    resolveFirstLookup({ outcome: { kind: 'not_found' } });
    const reportsA = await applyAPromise;

    expect(reportsA[0].outcome).not.toBe('SKIPPED_ACCOUNT_BUSY');
    expect(lookupCalls).toHaveLength(1);
  });

  it('once the first call releases the lock, a subsequent call proceeds normally (lock is not stuck forever)', async () => {
    const shipmentLookup = {
      lookup: () => Promise.resolve({ outcome: { kind: 'not_found' } }),
    };
    const service = buildService(shipmentLookup);

    const first = await service.apply({ accountId, maxRequestsPerAccount: 10 });
    expect(first[0].outcome).not.toBe('SKIPPED_ACCOUNT_BUSY');

    const second = await service.apply({
      accountId,
      maxRequestsPerAccount: 10,
    });
    expect(second[0].outcome).not.toBe('SKIPPED_ACCOUNT_BUSY');
  });
});
