import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProvisionAmazonAccountDto } from './provision-amazon-account.dto';

async function validateBody(body: Record<string, unknown>) {
  const instance = plainToInstance(ProvisionAmazonAccountDto, body);
  // Mesmas opções do ValidationPipe global registrado em main.ts.
  return validate(instance, { whitelist: true, forbidNonWhitelisted: true });
}

const VALID_BODY = {
  sellingPartnerId: 'A1SELLERPARTNERID',
  refreshToken: 'Atzr|valid-looking-refresh-token',
};

describe('ProvisionAmazonAccountDto', () => {
  it('accepts a well-formed body', async () => {
    expect(await validateBody(VALID_BODY)).toHaveLength(0);
  });

  it('rejects an empty sellingPartnerId', async () => {
    const errors = await validateBody({ ...VALID_BODY, sellingPartnerId: '' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an empty refreshToken', async () => {
    const errors = await validateBody({ ...VALID_BODY, refreshToken: '' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a missing sellingPartnerId', async () => {
    const { sellingPartnerId: _omit, ...body } = VALID_BODY;
    expect((await validateBody(body)).length).toBeGreaterThan(0);
  });

  it('rejects a missing refreshToken', async () => {
    const { refreshToken: _omit, ...body } = VALID_BODY;
    expect((await validateBody(body)).length).toBeGreaterThan(0);
  });

  it('rejects a sellingPartnerId over the length limit', async () => {
    const errors = await validateBody({
      ...VALID_BODY,
      sellingPartnerId: 'A'.repeat(65),
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a sellingPartnerId with non-alphanumeric characters', async () => {
    const errors = await validateBody({
      ...VALID_BODY,
      sellingPartnerId: 'A1-SELLER PARTNER;DROP TABLE',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a refreshToken over the length limit', async () => {
    const errors = await validateBody({
      ...VALID_BODY,
      refreshToken: 'A'.repeat(4097),
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-string sellingPartnerId/refreshToken', async () => {
    expect(
      (await validateBody({ ...VALID_BODY, sellingPartnerId: 123 })).length,
    ).toBeGreaterThan(0);
    expect(
      (await validateBody({ ...VALID_BODY, refreshToken: 123 })).length,
    ).toBeGreaterThan(0);
  });

  it('rejects any extra field — closed body, e.g. an attempted LWA Client Secret', async () => {
    const errors = await validateBody({
      ...VALID_BODY,
      lwaClientSecret: 'SHOULD_NEVER_BE_ACCEPTED',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an attempted accessToken/encryptedRefreshToken field — never accepted from the client', async () => {
    expect(
      (
        await validateBody({
          ...VALID_BODY,
          accessToken: 'should-never-be-accepted',
        })
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await validateBody({
          ...VALID_BODY,
          encryptedRefreshToken: 'should-never-be-accepted',
        })
      ).length,
    ).toBeGreaterThan(0);
  });
});
