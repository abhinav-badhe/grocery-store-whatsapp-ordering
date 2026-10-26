import type { PaymentRow, RefundRow, PaymentStatus } from '@grocery/database';
import type {
  DatabaseConnection,
  PaymentRepository,
  CreatePaymentParams,
  CreateRefundParams,
} from './types.js';
import { mapPaymentDatabaseError } from './errors.js';

export class KyselyPaymentRepository implements PaymentRepository {
  constructor(private readonly defaultDb: DatabaseConnection) {}

  private getExecutor(trx?: DatabaseConnection): DatabaseConnection {
    return trx ?? this.defaultDb;
  }

  async createPayment(params: CreatePaymentParams, trx?: DatabaseConnection): Promise<PaymentRow> {
    try {
      return await this.getExecutor(trx)
        .insertInto('payment.payments')
        .values({
          store_id: params.storeId,
          order_id: params.orderId,
          payment_method: params.paymentMethod,
          provider: params.provider,
          amount_cents: params.amountCents,
          currency: params.currency ?? 'INR',
          status: params.status ?? 'PENDING',
          provider_order_id: params.providerOrderId ?? null,
          provider_payment_id: params.providerPaymentId ?? null,
          idempotency_key: params.idempotencyKey ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (err) {
      throw mapPaymentDatabaseError(err, 'Failed to create payment');
    }
  }

  async findById(
    storeId: string,
    id: string,
    trx?: DatabaseConnection,
  ): Promise<PaymentRow | null> {
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('payment.payments')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('id', '=', id)
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapPaymentDatabaseError(err, `Failed to find payment '${id}'`);
    }
  }

  async findByOrderId(
    storeId: string,
    orderId: string,
    trx?: DatabaseConnection,
  ): Promise<PaymentRow | null> {
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('payment.payments')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('order_id', '=', orderId)
        .orderBy('created_at', 'desc')
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapPaymentDatabaseError(err, `Failed to find payment for order '${orderId}'`);
    }
  }

  async findByIdempotencyKey(
    storeId: string,
    idempotencyKey: string,
    trx?: DatabaseConnection,
  ): Promise<PaymentRow | null> {
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('payment.payments')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('idempotency_key', '=', idempotencyKey)
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapPaymentDatabaseError(
        err,
        `Failed to find payment by idempotency key '${idempotencyKey}'`,
      );
    }
  }

  async findByProviderPaymentId(
    provider: string,
    providerPaymentId: string,
    trx?: DatabaseConnection,
  ): Promise<PaymentRow | null> {
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('payment.payments')
        .selectAll()
        .where('provider', '=', provider as any)
        .where('provider_payment_id', '=', providerPaymentId)
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapPaymentDatabaseError(
        err,
        `Failed to find payment by provider payment ID '${providerPaymentId}'`,
      );
    }
  }

  async updateStatus(
    storeId: string,
    id: string,
    status: PaymentStatus,
    providerPaymentId?: string | null,
    trx?: DatabaseConnection,
  ): Promise<PaymentRow | null> {
    try {
      const updatePayload: Record<string, unknown> = {
        status,
        updated_at: new Date(),
      };
      if (providerPaymentId !== undefined && providerPaymentId !== null) {
        updatePayload.provider_payment_id = providerPaymentId;
      }

      const row = await this.getExecutor(trx)
        .updateTable('payment.payments')
        .set(updatePayload)
        .where('store_id', '=', storeId)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();

      return row ?? null;
    } catch (err) {
      throw mapPaymentDatabaseError(err, `Failed to update status for payment '${id}'`);
    }
  }

  async createRefund(params: CreateRefundParams, trx?: DatabaseConnection): Promise<RefundRow> {
    try {
      return await this.getExecutor(trx)
        .insertInto('payment.refunds')
        .values({
          payment_id: params.paymentId,
          store_id: params.storeId,
          amount_cents: params.amountCents,
          reason: params.reason ?? null,
          provider_refund_id: params.providerRefundId ?? null,
          status: params.status ?? 'PENDING',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (err) {
      throw mapPaymentDatabaseError(err, 'Failed to create refund');
    }
  }

  async listRefundsByPayment(
    storeId: string,
    paymentId: string,
    trx?: DatabaseConnection,
  ): Promise<RefundRow[]> {
    try {
      return await this.getExecutor(trx)
        .selectFrom('payment.refunds')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('payment_id', '=', paymentId)
        .orderBy('created_at', 'asc')
        .execute();
    } catch (err) {
      throw mapPaymentDatabaseError(err, `Failed to list refunds for payment '${paymentId}'`);
    }
  }
}

export function createPaymentRepository(db: DatabaseConnection): PaymentRepository {
  return new KyselyPaymentRepository(db);
}
