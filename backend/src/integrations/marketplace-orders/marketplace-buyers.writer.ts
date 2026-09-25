import type { QueryRunner } from 'typeorm';
import type { EncryptionService } from '../../common/encryption/encryption.service';
import {
  isUsableValue,
  mergeBuyerSnapshot,
  type BuyerPersonalData,
  type MappedBuyerRecord,
} from './buyer-snapshot';

interface BuyerRow {
  id: string;
  username: string | null;
  buyer_name_encrypted: string | null;
  recipient_name_encrypted: string | null;
  email_encrypted: string | null;
  recipient_phone_encrypted: string | null;
  city: string | null;
  state: string | null;
  postal_code_encrypted: string | null;
  personal_data_last_updated_at: Date | null;
}

/**
 * Escrita de `marketplace_buyers` DENTRO de uma transação do chamador
 * (nunca abre transação própria, nunca chama rede). Linha travada com
 * `FOR UPDATE` antes do merge, então duas sincronizações concorrentes do
 * mesmo comprador nunca perdem atualização. Nomes, e-mail, telefone e CEP só
 * existem em texto claro em memória — persistidos via `EncryptionService`;
 * `has_*` guarda apenas se o valor está disponível (presente e não mascarado).
 */
export class MarketplaceBuyersWriter {
  constructor(private readonly encryption: EncryptionService) {}

  async upsert(
    queryRunner: QueryRunner,
    marketplaceAccountId: string,
    buyer: MappedBuyerRecord,
    observedAt: Date,
  ): Promise<string> {
    await queryRunner.query(
      `INSERT INTO marketplace_buyers (marketplace_account_id, external_buyer_id, data_source)
         VALUES ($1, $2, $3)
         ON CONFLICT (marketplace_account_id, external_buyer_id) DO NOTHING`,
      [marketplaceAccountId, buyer.externalBuyerId, buyer.dataSource],
    );
    const rows = (await queryRunner.query(
      `SELECT id, username, buyer_name_encrypted, recipient_name_encrypted,
              email_encrypted, recipient_phone_encrypted, city, state,
              postal_code_encrypted, personal_data_last_updated_at
         FROM marketplace_buyers
        WHERE marketplace_account_id = $1 AND external_buyer_id = $2
        FOR UPDATE`,
      [marketplaceAccountId, buyer.externalBuyerId],
    )) as BuyerRow[];
    const row = rows[0];

    const { snapshot, changed } = mergeBuyerSnapshot(
      {
        data: this.decryptRow(row),
        personalDataLastUpdatedAt: row.personal_data_last_updated_at,
      },
      buyer,
      observedAt,
    );
    if (!changed) return row.id;

    const data = snapshot.data;
    await queryRunner.query(
      `UPDATE marketplace_buyers
          SET username = $2, buyer_name_encrypted = $3, recipient_name_encrypted = $4,
              email_encrypted = $5, recipient_phone_encrypted = $6, city = $7,
              state = $8, postal_code_encrypted = $9,
              has_buyer_name = $10, has_recipient_name = $11, has_email = $12,
              has_recipient_phone = $13,
              personal_data_last_updated_at = $14, updated_at = now()
        WHERE id = $1`,
      [
        row.id,
        data.username,
        this.encryptOrNull(data.buyerName),
        this.encryptOrNull(data.recipientName),
        this.encryptOrNull(data.email),
        this.encryptOrNull(data.recipientPhone),
        data.city,
        data.state,
        this.encryptOrNull(data.postalCode),
        isUsableValue(data.buyerName),
        isUsableValue(data.recipientName),
        isUsableValue(data.email),
        isUsableValue(data.recipientPhone),
        snapshot.personalDataLastUpdatedAt,
      ],
    );
    return row.id;
  }

  private decryptRow(row: BuyerRow): BuyerPersonalData {
    return {
      username: row.username,
      buyerName: this.decryptOrNull(row.buyer_name_encrypted),
      recipientName: this.decryptOrNull(row.recipient_name_encrypted),
      email: this.decryptOrNull(row.email_encrypted),
      recipientPhone: this.decryptOrNull(row.recipient_phone_encrypted),
      city: row.city,
      state: row.state,
      postalCode: this.decryptOrNull(row.postal_code_encrypted),
    };
  }

  private encryptOrNull(value: string | null): string | null {
    return value === null ? null : this.encryption.encrypt(value);
  }

  private decryptOrNull(value: string | null): string | null {
    return value === null ? null : this.encryption.decrypt(value);
  }
}
