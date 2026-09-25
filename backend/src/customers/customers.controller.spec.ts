import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { Readable } from 'stream';
import {
  BuyerEnrichmentModeConflictError,
  BuyerEnrichmentService,
} from '../integrations/marketplace-sync/buyer-enrichment.service';
import { UsersService } from '../users/users.service';
import { CustomerPermissionGuard } from './customer-permissions';
import { CustomersExportService } from './customers-export.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

describe('CustomersController (HTTP)', () => {
  let app: INestApplication;
  let currentUserId: string | null;
  const http = () => app.getHttpServer() as Parameters<typeof request>[0];
  const customersService = {
    getSummary: jest.fn().mockResolvedValue({ customers: [] }),
    getBuyerOrders: jest.fn().mockResolvedValue([]),
    canExportPersonalData: jest.fn(),
  };
  const exportService = {
    export: jest.fn(() =>
      Promise.resolve({
        stream: Readable.from([Buffer.from('xlsx-bytes')]),
        filename: 'clientes_todo-o-periodo_gerado-2026-09-25_1200.xlsx',
        done: Promise.resolve(),
      }),
    ),
  };
  const enrichmentService = {
    getStatus: jest
      .fn()
      .mockResolvedValue({ workerEnabled: false, accounts: [] }),
    start: jest.fn().mockResolvedValue({ workerEnabled: false, accounts: [] }),
    pause: jest.fn(),
    resume: jest.fn(),
  };
  const usersService = {
    findById: jest.fn((id: string) =>
      Promise.resolve({ id, active: true, isAdmin: id === ADMIN_ID }),
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CustomersController],
      providers: [
        CustomerPermissionGuard,
        { provide: CustomersService, useValue: customersService },
        { provide: CustomersExportService, useValue: exportService },
        { provide: BuyerEnrichmentService, useValue: enrichmentService },
        { provide: UsersService, useValue: usersService },
      ],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          if (currentUserId === null) return false;
          const req = context.switchToHttp().getRequest<Request>();
          req.user = { sub: currentUserId } as never;
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    currentUserId = ADMIN_ID;
  });

  it.each([
    ['get', '/customers/summary'],
    ['get', '/customers/export.xlsx'],
    ['get', `/customers/${ADMIN_ID}/orders`],
    ['get', '/customers/enrichment/status'],
    ['post', '/customers/enrichment/start'],
  ] as const)(
    'non-admin %s %s → 403, service never called',
    async (method, path) => {
      currentUserId = USER_ID;
      await request(http())[method](path).expect(403);
      expect(customersService.getSummary).not.toHaveBeenCalled();
      expect(exportService.export).not.toHaveBeenCalled();
      expect(enrichmentService.start).not.toHaveBeenCalled();
    },
  );

  it('admin gets the summary; invalid filter → 400 with closed code', async () => {
    await request(http()).get('/customers/summary').expect(200);
    const response = await request(http())
      .get('/customers/summary?marketplace=AMAZON')
      .expect(400);
    expect((response.body as { message: string }).message).toBe(
      'INVALID_MARKETPLACE',
    );
  });

  it('repeated query parameters are rejected before parsing', async () => {
    await request(http())
      .get('/customers/summary?search=a&search=b')
      .expect(400);
  });

  it('export streams an xlsx attachment, no-store, never a public URL', async () => {
    customersService.canExportPersonalData.mockResolvedValue(true);
    const response = await request(http())
      .get('/customers/export.xlsx')
      .expect(200);
    expect(response.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="clientes_todo-o-periodo_gerado-2026-09-25_1200.xlsx"',
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers.location).toBeUndefined();
    expect(exportService.export).toHaveBeenCalledWith(
      expect.objectContaining({ period: null }),
      true,
      ADMIN_ID,
      expect.any(Date),
      expect.any(AbortSignal),
    );
  });

  it('client disconnect aborts the export generation (signal)', async () => {
    customersService.canExportPersonalData.mockResolvedValue(true);
    let signal: AbortSignal | undefined;
    exportService.export.mockImplementationOnce((...args: unknown[]) => {
      signal = args[4] as AbortSignal;
      // Stream que nunca termina sozinho — só o aborto encerra.
      const stream = new Readable({ read() {} });
      return Promise.resolve({
        stream,
        filename: 'x.xlsx',
        done: Promise.resolve(),
      });
    });
    const pending = request(http())
      .get('/customers/export.xlsx')
      .timeout(300)
      .then(
        () => null,
        () => null,
      );
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(signal?.aborted).toBe(true);
  });

  it('enrichment start for one account with the history backfill active → 409 with a clear code', async () => {
    enrichmentService.start.mockRejectedValueOnce(
      new BuyerEnrichmentModeConflictError(),
    );
    const response = await request(http())
      .post('/customers/enrichment/start')
      .send({ accountId: ADMIN_ID })
      .expect(409);
    expect((response.body as { message: string }).message).toBe(
      'BACKFILL_JOB_MODE_CONFLICT',
    );
  });

  it('personal-data export without that permission → 403', async () => {
    customersService.canExportPersonalData.mockResolvedValue(false);
    await request(http()).get('/customers/export.xlsx').expect(403);
    expect(exportService.export).not.toHaveBeenCalled();
  });

  it('enrichment start validates the optional accountId', async () => {
    await request(http())
      .post('/customers/enrichment/start')
      .send({ accountId: 'nao-uuid' })
      .expect(400);
    await request(http())
      .post('/customers/enrichment/start')
      .send({})
      .expect(200);
    expect(enrichmentService.start).toHaveBeenCalledWith(undefined);
  });
});
