import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { AdvisoryLockService } from './advisory-lock.service';
import { deriveAdvisoryLockKey } from './advisory-lock.util';

function makeConfigService(waitMs: number): ConfigService {
  return {
    get: (key: string, fallback?: unknown) =>
      key === 'ML_ACCOUNT_LOCK_WAIT_MS' ? waitMs : fallback,
  } as unknown as ConfigService;
}

describe('AdvisoryLockService (real Postgres)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    // Sem entidades: `AdvisoryLockService` só usa `pg_try_advisory_lock`/
    // `pg_advisory_unlock` via SQL cru, nunca um `Repository`. Ainda assim
    // usa o helper compartilhado (não um `new DataSource(...)` inline) para
    // manter um único ponto de criação de `DataSource` de teste em todo o
    // plano.
    dataSource = await createTestDataSource([]);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('acquires and releases a lock on a fresh account', async () => {
    const service = new AdvisoryLockService(
      dataSource,
      makeConfigService(1000),
    );
    const handle = await service.tryAcquire(randomUUID());

    expect(handle).not.toBeNull();
    await handle!.release();
  });

  it('a second acquisition attempt on the SAME account fails while the first holds the lock, using two real connections', async () => {
    const accountId = randomUUID();
    const holder = new AdvisoryLockService(dataSource, makeConfigService(1000));
    const contender = new AdvisoryLockService(
      dataSource,
      makeConfigService(300),
    );

    const holderHandle = await holder.tryAcquire(accountId);
    expect(holderHandle).not.toBeNull();

    const contenderHandle = await contender.tryAcquire(accountId);
    expect(contenderHandle).toBeNull();

    await holderHandle!.release();
  });

  it('after release, a new acquisition on the same account succeeds again', async () => {
    const accountId = randomUUID();
    const service = new AdvisoryLockService(
      dataSource,
      makeConfigService(1000),
    );

    const first = await service.tryAcquire(accountId);
    await first!.release();

    const second = await service.tryAcquire(accountId);
    expect(second).not.toBeNull();
    await second!.release();
  });

  it('locking account A never blocks a concurrent acquisition on account B', async () => {
    const service = new AdvisoryLockService(
      dataSource,
      makeConfigService(1000),
    );

    const handleA = await service.tryAcquire(randomUUID());
    const handleB = await service.tryAcquire(randomUUID());

    expect(handleA).not.toBeNull();
    expect(handleB).not.toBeNull();

    await handleA!.release();
    await handleB!.release();
  });

  it('releasing frees the underlying pg_advisory_lock at the database level', async () => {
    const accountId = randomUUID();
    const service = new AdvisoryLockService(
      dataSource,
      makeConfigService(1000),
    );
    const key = deriveAdvisoryLockKey(accountId).toString();

    const handle = await service.tryAcquire(accountId);
    await handle!.release();

    // Verificação e limpeza usam o MESMO QueryRunner (mesma conexão física
    // de verdade) — `dataSource.query(...)` em duas chamadas separadas não
    // garante isso (o pool pode devolver conexões diferentes a cada
    // chamada), e `pg_advisory_unlock` só tem efeito na sessão que
    // efetivamente detém o lock: destravar de uma sessão errada é um no-op
    // silencioso (retorna `false`, não lança), o que deixaria o lock preso
    // na conexão que o adquiriu até o pool reciclá-la.
    const verifier = dataSource.createQueryRunner();
    await verifier.connect();
    try {
      const rows = (await verifier.query(
        'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
        [key],
      )) as Array<{ acquired: boolean }>;
      expect(rows[0].acquired).toBe(true);

      const unlockRows = (await verifier.query(
        'SELECT pg_advisory_unlock($1::bigint) AS released',
        [key],
      )) as Array<{ released: boolean }>;
      expect(unlockRows[0].released).toBe(true);
    } finally {
      await verifier.release();
    }
  });

  it('an exception thrown while polling pg_try_advisory_lock still releases the QueryRunner exactly once, never leaves the connection dangling', async () => {
    const service = new AdvisoryLockService(
      dataSource,
      makeConfigService(1000),
    );
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockRejectedValue(new Error('connection reset')),
      release: jest.fn().mockResolvedValue(undefined),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(
        fakeQueryRunner as unknown as ReturnType<
          DataSource['createQueryRunner']
        >,
      );

    await expect(service.tryAcquire(randomUUID())).rejects.toThrow(
      'connection reset',
    );

    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('release(): uma falha em pg_advisory_unlock ainda tenta liberar o QueryRunner exatamente uma vez, e propaga o erro do unlock', async () => {
    const service = new AdvisoryLockService(
      dataSource,
      makeConfigService(1000),
    );
    const unlockError = new Error('connection reset during unlock');
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([{ acquired: true }]) // pg_try_advisory_lock
        .mockRejectedValueOnce(unlockError), // pg_advisory_unlock
      release: jest.fn().mockResolvedValue(undefined),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(
        fakeQueryRunner as unknown as ReturnType<
          DataSource['createQueryRunner']
        >,
      );

    const handle = await service.tryAcquire(randomUUID());
    expect(handle).not.toBeNull();

    await expect(handle!.release()).rejects.toBe(unlockError);
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('release(): uma falha em QueryRunner.release() propaga o erro, e uma segunda chamada a release() não tenta liberar de novo (idempotência mesmo após falha)', async () => {
    const service = new AdvisoryLockService(
      dataSource,
      makeConfigService(1000),
    );
    const releaseError = new Error('pool exhausted, cannot release');
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([{ acquired: true }]) // pg_try_advisory_lock
        .mockResolvedValueOnce(undefined), // pg_advisory_unlock
      release: jest.fn().mockRejectedValue(releaseError),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(
        fakeQueryRunner as unknown as ReturnType<
          DataSource['createQueryRunner']
        >,
      );

    const handle = await service.tryAcquire(randomUUID());
    expect(handle).not.toBeNull();

    await expect(handle!.release()).rejects.toBe(releaseError);
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);

    // Segunda chamada ao MESMO handle: não deve tentar `pg_advisory_unlock`
    // nem `queryRunner.release()` outra vez, mesmo a primeira tentativa
    // tendo falhado.
    await expect(handle!.release()).resolves.toBeUndefined();
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);
    expect(fakeQueryRunner.query).toHaveBeenCalledTimes(2);
  });

  it('release(): duas chamadas consecutivas bem-sucedidas ao mesmo AdvisoryLockHandle só liberam o lock/QueryRunner uma única vez', async () => {
    const accountId = randomUUID();
    const service = new AdvisoryLockService(
      dataSource,
      makeConfigService(1000),
    );

    const handle = await service.tryAcquire(accountId);
    expect(handle).not.toBeNull();

    await handle!.release();
    await expect(handle!.release()).resolves.toBeUndefined();

    // O lock já foi liberado de verdade na primeira chamada — uma nova
    // aquisição para a mesma conta deve funcionar normalmente, provando que
    // a segunda chamada a `release()` não tentou (e não conseguiria) um
    // segundo `pg_advisory_unlock` sobre uma conexão já fechada.
    const reacquired = await service.tryAcquire(accountId);
    expect(reacquired).not.toBeNull();
    await reacquired!.release();
  });

  it('tryAcquire(): timeout (nenhum acquired) seguido de falha em queryRunner.release() chama release() exatamente uma vez e propaga o erro do release', async () => {
    const releaseError = new Error('pool exhausted during timeout cleanup');
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      // Nunca adquire: toda chamada a pg_try_advisory_lock retorna false,
      // então o loop expira e cai no ramo de timeout (`return null`).
      query: jest.fn().mockResolvedValue([{ acquired: false }]),
      release: jest.fn().mockRejectedValue(releaseError),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(
        fakeQueryRunner as unknown as ReturnType<
          DataSource['createQueryRunner']
        >,
      );

    await expect(
      new AdvisoryLockService(dataSource, makeConfigService(50)).tryAcquire(
        randomUUID(),
      ),
    ).rejects.toBe(releaseError);

    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('tryAcquire(): falha de query durante o polling seguida de falha no cleanup preserva o erro da query original e chama release() exatamente uma vez', async () => {
    const service = new AdvisoryLockService(
      dataSource,
      makeConfigService(1000),
    );
    const queryError = new Error('connection reset mid-poll');
    const releaseError = new Error('cleanup also failed');
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockRejectedValue(queryError),
      release: jest.fn().mockRejectedValue(releaseError),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(
        fakeQueryRunner as unknown as ReturnType<
          DataSource['createQueryRunner']
        >,
      );

    await expect(service.tryAcquire(randomUUID())).rejects.toBe(queryError);

    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('release(): falha simultânea de pg_advisory_unlock e queryRunner.release() preserva o erro do unlock como erro primário', async () => {
    const service = new AdvisoryLockService(
      dataSource,
      makeConfigService(1000),
    );
    const unlockError = new Error('unlock failed');
    const releaseError = new Error('release also failed');
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([{ acquired: true }]) // pg_try_advisory_lock
        .mockRejectedValueOnce(unlockError), // pg_advisory_unlock
      release: jest.fn().mockRejectedValue(releaseError),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(
        fakeQueryRunner as unknown as ReturnType<
          DataSource['createQueryRunner']
        >,
      );

    const handle = await service.tryAcquire(randomUUID());
    expect(handle).not.toBeNull();

    await expect(handle!.release()).rejects.toBe(unlockError);
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('release(): a segunda chamada ao mesmo handle não repete nem pg_advisory_unlock nem queryRunner.release(), mesmo após falha na primeira', async () => {
    const service = new AdvisoryLockService(
      dataSource,
      makeConfigService(1000),
    );
    const unlockError = new Error('unlock failed');
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([{ acquired: true }]) // pg_try_advisory_lock
        .mockRejectedValueOnce(unlockError), // pg_advisory_unlock
      release: jest.fn().mockResolvedValue(undefined),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(
        fakeQueryRunner as unknown as ReturnType<
          DataSource['createQueryRunner']
        >,
      );

    const handle = await service.tryAcquire(randomUUID());
    expect(handle).not.toBeNull();

    await expect(handle!.release()).rejects.toBe(unlockError);
    await expect(handle!.release()).resolves.toBeUndefined();

    // `query` só foi chamado 2x (lock + unlock) — a segunda `release()` não
    // reenviou `pg_advisory_unlock`, e `release` do QueryRunner continua em
    // 1 chamada só.
    expect(fakeQueryRunner.query).toHaveBeenCalledTimes(2);
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);
  });
});
