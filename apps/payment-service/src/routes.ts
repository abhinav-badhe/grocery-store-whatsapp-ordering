import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpRequestHandler } from '@grocery/service-runtime';
import type { RequestContext } from '@grocery/observability';
import {
  PaymentSchema,
  RefundSchema,
  CreatePaymentInputSchema,
  CreateRefundInputSchema,
  type Payment,
  type Refund,
  type PaymentStatus,
  type PaymentMethod,
  type PaymentProvider,
  type RefundStatus,
} from '@grocery/api-contracts';
import type { PaymentRow, RefundRow } from '@grocery/database';
import type { PaymentService } from './service/types.js';
import { PaymentDomainError } from './service/errors.js';

const MAX_JSON_BODY_BYTES = 64 * 1024; // 64 KiB

export function toPaymentDto(row: PaymentRow): Payment {
  return {
    id: row.id,
    storeId: row.store_id,
    orderId: row.order_id,
    paymentMethod: row.payment_method as PaymentMethod,
    provider: row.provider as PaymentProvider,
    providerOrderId: row.provider_order_id ?? null,
    providerPaymentId: row.provider_payment_id ?? null,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    status: row.status as PaymentStatus,
    idempotencyKey: row.idempotency_key ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function toRefundDto(row: RefundRow): Refund {
  return {
    id: row.id,
    paymentId: row.payment_id,
    storeId: row.store_id,
    amountCents: Number(row.amount_cents),
    reason: row.reason ?? null,
    providerRefundId: row.provider_refund_id ?? null,
    status: row.status as RefundStatus,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function readRawBody(req: IncomingMessage, maxBytes = MAX_JSON_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    let exceeded = false;

    req.on('data', (chunk: Buffer) => {
      if (exceeded) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        exceeded = true;
        reject(
          new PaymentDomainError(
            `Payload exceeds maximum allowed size of ${maxBytes} bytes`,
            413,
            'PAYLOAD_TOO_LARGE',
          ),
        );
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (exceeded) return;
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });

    req.on('error', (err) => {
      reject(new PaymentDomainError(`Error reading request: ${err.message}`, 400, 'READ_ERROR'));
    });
  });
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

function sendRfc7807(
  res: ServerResponse,
  statusCode: number,
  title: string,
  detail: string,
  code?: string,
): void {
  res.setHeader('Content-Type', 'application/problem+json; charset=utf-8');
  res.statusCode = statusCode;
  res.end(
    JSON.stringify({
      type: 'https://tools.ietf.org/html/rfc7807',
      title,
      status: statusCode,
      detail,
      ...(code ? { code } : {}),
    }),
  );
}

function resolveStoreId(req: IncomingMessage, url: URL): string | null {
  const headerStoreId = req.headers['x-store-id'];
  if (typeof headerStoreId === 'string' && headerStoreId.trim().length > 0) {
    return headerStoreId.trim();
  }
  const queryStoreId = url.searchParams.get('storeId');
  if (queryStoreId && queryStoreId.trim().length > 0) {
    return queryStoreId.trim();
  }
  return null;
}

export interface PaymentRoutesOptions {
  readonly paymentService: PaymentService;
}

export function createPaymentRoutes(options: PaymentRoutesOptions): HttpRequestHandler {
  const { paymentService } = options;

  return async (req: IncomingMessage, res: ServerResponse, context?: RequestContext) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    try {
      // Health endpoints
      if (pathname === '/health/live' && method === 'GET') {
        sendJson(res, 200, { status: 'healthy', check: 'live' });
        return;
      }
      if (pathname === '/health/ready' && method === 'GET') {
        sendJson(res, 200, { status: 'ready', check: 'ready' });
        return;
      }

      // Root info
      if (pathname === '/' && method === 'GET') {
        sendJson(res, 200, {
          service: 'payment-service',
          status: 'operational',
          description: 'Payment Gateway Integration & Webhook Lifecycle Boundary',
        });
        return;
      }

      // Webhook ingress: POST /api/v1/payments/webhooks/:provider (Raw body & signature header)
      const webhookMatch = pathname.match(/^\/api\/v1\/payments\/webhooks\/([^/]+)$/);
      if (webhookMatch && method === 'POST') {
        const rawProvider = webhookMatch[1]!.toUpperCase() as PaymentProvider;
        const rawBody = await readRawBody(req);

        // Header lookup for signatures
        const signature =
          (req.headers['x-razorpay-signature'] as string | undefined) ??
          (req.headers['stripe-signature'] as string | undefined) ??
          (req.headers['x-payment-signature'] as string | undefined) ??
          '';

        const storeId = resolveStoreId(req, url) ?? undefined;

        const result = await paymentService.handleWebhook(rawProvider, rawBody, signature, storeId);

        sendJson(res, 200, result);
        return;
      }

      // Domain API endpoints requiring store context
      if (pathname.startsWith('/api/v1/payments')) {
        const storeId = resolveStoreId(req, url);
        if (!storeId) {
          sendRfc7807(
            res,
            400,
            'Missing Store Context',
            'Header x-store-id or query param storeId is required',
            'MISSING_STORE_ID',
          );
          return;
        }

        const authenticatedTenant = (req as any).internalToken?.tid;
        if (authenticatedTenant && authenticatedTenant !== storeId) {
          sendRfc7807(
            res,
            403,
            'Tenant Mismatch',
            'Store ID does not match internal token tenant',
            'TENANT_MISMATCH',
          );
          return;
        }

        // POST /api/v1/payments - Initiate payment
        if (pathname === '/api/v1/payments' && method === 'POST') {
          const rawBody = await readRawBody(req);
          let bodyJson: unknown;
          try {
            bodyJson = JSON.parse(rawBody);
          } catch {
            sendRfc7807(
              res,
              400,
              'Malformed JSON',
              'Invalid JSON body in payment request',
              'MALFORMED_JSON',
            );
            return;
          }

          const parseResult = CreatePaymentInputSchema.safeParse(bodyJson);
          if (!parseResult.success) {
            sendRfc7807(
              res,
              400,
              'Validation Error',
              parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
              'VALIDATION_ERROR',
            );
            return;
          }

          const payment = await paymentService.initiatePayment({
            storeId,
            orderId: parseResult.data.orderId,
            paymentMethod: parseResult.data.paymentMethod,
            provider: parseResult.data.provider,
            amountCents: parseResult.data.amountCents,
            idempotencyKey: parseResult.data.idempotencyKey ?? null,
          });

          sendJson(res, 201, { payment: toPaymentDto(payment) });
          return;
        }

        // GET /api/v1/payments/order/:orderId
        const orderPaymentMatch = pathname.match(/^\/api\/v1\/payments\/order\/([^/]+)$/);
        if (orderPaymentMatch && method === 'GET') {
          const orderId = orderPaymentMatch[1]!;
          const payment = await paymentService.getPaymentByOrderId(storeId, orderId);
          if (!payment) {
            sendRfc7807(
              res,
              404,
              'Not Found',
              `Payment for order '${orderId}' not found`,
              'PAYMENT_NOT_FOUND',
            );
            return;
          }
          sendJson(res, 200, { payment: toPaymentDto(payment) });
          return;
        }

        // GET /api/v1/payments/:id
        const paymentIdMatch = pathname.match(/^\/api\/v1\/payments\/([^/]+)$/);
        if (paymentIdMatch && method === 'GET') {
          const paymentId = paymentIdMatch[1]!;
          const payment = await paymentService.getPayment(storeId, paymentId);
          sendJson(res, 200, { payment: toPaymentDto(payment) });
          return;
        }

        // POST /api/v1/payments/:id/refund
        const refundMatch = pathname.match(/^\/api\/v1\/payments\/([^/]+)\/refund$/);
        if (refundMatch && method === 'POST') {
          const paymentId = refundMatch[1]!;
          const rawBody = await readRawBody(req);
          let bodyJson: unknown = {};
          if (rawBody.trim().length > 0) {
            try {
              bodyJson = JSON.parse(rawBody);
            } catch {
              sendRfc7807(
                res,
                400,
                'Malformed JSON',
                'Invalid JSON body in refund request',
                'MALFORMED_JSON',
              );
              return;
            }
          }

          const parseResult = CreateRefundInputSchema.safeParse(bodyJson);
          if (!parseResult.success) {
            sendRfc7807(
              res,
              400,
              'Validation Error',
              parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
              'VALIDATION_ERROR',
            );
            return;
          }

          const refund = await paymentService.refundPayment(
            storeId,
            paymentId,
            parseResult.data.amountCents,
            parseResult.data.reason,
          );

          sendJson(res, 200, { refund: toRefundDto(refund) });
          return;
        }
      }

      sendRfc7807(res, 404, 'Not Found', `Cannot ${method} ${pathname}`, 'NOT_FOUND');
    } catch (err) {
      if (err instanceof PaymentDomainError) {
        sendRfc7807(res, err.statusCode, err.name, err.message, err.code);
        return;
      }

      sendRfc7807(
        res,
        500,
        'Internal Server Error',
        err instanceof Error ? err.message : 'An unexpected error occurred',
        'INTERNAL_ERROR',
      );
    }
  };
}
