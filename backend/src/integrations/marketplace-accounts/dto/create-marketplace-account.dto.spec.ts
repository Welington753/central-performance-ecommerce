import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMarketplaceAccountDto } from './create-marketplace-account.dto';

async function validateBody(body: Record<string, unknown>) {
  const instance = plainToInstance(CreateMarketplaceAccountDto, body);
  // Mesmas opções do ValidationPipe global registrado em main.ts.
  return validate(instance, { whitelist: true, forbidNonWhitelisted: true });
}

describe('CreateMarketplaceAccountDto', () => {
  it('accepts a valid MERCADO_LIVRE body with no nickname', async () => {
    expect(await validateBody({ marketplace: 'MERCADO_LIVRE' })).toHaveLength(
      0,
    );
  });

  it('accepts an optional nickname', async () => {
    expect(
      await validateBody({
        marketplace: 'MERCADO_LIVRE',
        nickname: 'Loja principal',
      }),
    ).toHaveLength(0);
  });

  it('rejects a marketplace other than MERCADO_LIVRE (Amazon/Shopee have no connector wired in this phase)', async () => {
    const errors = await validateBody({ marketplace: 'AMAZON' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an unrecognized marketplace string', async () => {
    const errors = await validateBody({ marketplace: 'NOT_A_MARKETPLACE' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an externalSellerId sent by the client — never accepted from a request body (design §6.2: só preenchido após /users/me)', async () => {
    const errors = await validateBody({
      marketplace: 'MERCADO_LIVRE',
      externalSellerId: 'client-supplied-seller-id',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects any other unexpected extra field', async () => {
    const errors = await validateBody({
      marketplace: 'MERCADO_LIVRE',
      unexpected: 'x',
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
