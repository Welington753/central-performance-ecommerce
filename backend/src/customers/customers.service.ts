import { Injectable } from '@nestjs/common';
import { EncryptionService } from '../common/encryption/encryption.service';
import { decimalStringToCents } from '../integrations/marketplace-orders/money.util';
import { UsersService } from '../users/users.service';
import {
  CUSTOMER_PERMISSIONS,
  hasCustomerPermission,
} from './customer-permissions';
import {
  classifyCustomer,
  divideCentsOrNull,
  toCustomerCards,
  type CustomerRecord,
} from './customer-metrics';
import {
  fulfillmentLabel,
  toCustomersSummaryResponse,
  type CustomerOrderLineDto,
  type CustomersSummaryResponseDto,
} from './customers.dto';
import type { CustomersFilter, CustomersPagination } from './customers-query';
import {
  CustomersRepository,
  type BuyerAggregateRow,
  type TopProductRow,
} from './customers.repository';

/**
 * Regras de negócio da função "Clientes". Filtro/ordenação/paginação/cards
 * rodam no banco; dado pessoal só é descriptografado para as linhas que vão
 * ser devolvidas (página da tela ou lote da exportação) — nunca logado,
 * nunca devolvido sem máscara pela API de tela. Todo chamador já passou por
 * `CustomerPermissionGuard` (administrador).
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly repository: CustomersRepository,
    private readonly encryption: EncryptionService,
    private readonly usersService: UsersService,
  ) {}

  async getSummary(
    filter: CustomersFilter,
    pagination: CustomersPagination,
  ): Promise<CustomersSummaryResponseDto> {
    const [cardsRow, pageRows] = await Promise.all([
      this.repository.findCards(filter),
      this.repository.findBuyerPage(
        filter,
        pagination.pageSize,
        (pagination.page - 1) * pagination.pageSize,
      ),
    ]);
    const topProducts = await this.repository.findTopProducts(
      filter,
      pageRows.map((row) => row.buyer_id),
    );
    return toCustomersSummaryResponse(
      filter,
      pagination,
      this.toRecords(pageRows, topProducts),
      toCustomerCards(cardsRow),
    );
  }

  async getBuyerOrders(
    buyerId: string,
    filter: CustomersFilter,
  ): Promise<CustomerOrderLineDto[]> {
    const rows = await this.repository.findBuyerOrderLines(filter, buyerId);
    return rows.map((row) => ({
      externalOrderId: row.external_order_id,
      dateCreated: row.date_created.toISOString(),
      status: row.status,
      sourceStatus: row.source_status,
      sellerSku: row.seller_sku,
      title: row.title,
      externalItemId: row.external_item_id,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      orderTotal: row.total_amount,
      refundedAmount: row.refunded_amount,
      fulfillment: fulfillmentLabel(row.logistics_classification),
    }));
  }

  async canExportPersonalData(userId: string): Promise<boolean> {
    const user = await this.usersService.findById(userId);
    return (
      user !== null &&
      hasCustomerPermission(user, CUSTOMER_PERMISSIONS.EXPORT_PERSONAL_DATA)
    );
  }

  /** Lote (página ou `FETCH`) → registros descriptografados, com produto mais comprado. */
  toRecords(
    rows: BuyerAggregateRow[],
    topProducts: TopProductRow[],
  ): CustomerRecord[] {
    const topByBuyer = new Map(topProducts.map((row) => [row.buyer_id, row]));
    return rows.map((row) =>
      this.toRecord(row, topByBuyer.get(row.buyer_id) ?? null),
    );
  }

  private toRecord(
    row: BuyerAggregateRow,
    top: TopProductRow | null,
  ): CustomerRecord {
    const paidRevenueCents = decimalStringToCents(row.paid_revenue);
    return {
      buyerId: row.buyer_id,
      accountId: row.marketplace_account_id,
      marketplace: row.marketplace,
      accountNickname: row.account_nickname,
      externalBuyerId: row.external_buyer_id,
      username: row.username,
      buyerName: this.decrypt(row.buyer_name_encrypted),
      recipientName: this.decrypt(row.recipient_name_encrypted),
      email: this.decrypt(row.email_encrypted),
      recipientPhone: this.decrypt(row.recipient_phone_encrypted),
      city: row.city,
      state: row.state,
      postalCode: this.decrypt(row.postal_code_encrypted),
      totalOrders: row.total_orders,
      validOrders: row.valid_orders,
      paidOrders: row.paid_orders,
      paidRevenueCents,
      refundedCents:
        row.refunded_amount === null
          ? null
          : decimalStringToCents(row.refunded_amount),
      units: Number(row.units),
      averageTicketCents: divideCentsOrNull(paidRevenueCents, row.paid_orders),
      firstPurchaseAt: row.first_purchase_at,
      lastPurchaseAt: row.last_purchase_at,
      lastOrderAt: row.last_order_at,
      customerType: classifyCustomer(row.valid_orders),
      topProduct: top
        ? {
            title: top.title,
            sellerSku: top.seller_sku,
            externalItemId: top.external_item_id,
            units: Number(top.units),
          }
        : null,
    };
  }

  private decrypt(value: string | null): string | null {
    return value === null ? null : this.encryption.decrypt(value);
  }
}
