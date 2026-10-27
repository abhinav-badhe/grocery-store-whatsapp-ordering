import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpRequestHandler } from '@grocery/service-runtime';
import type { RequestContext } from '@grocery/observability';
import {
  OrderSchema,
  OrderResponseSchema,
  PaginatedOrderListResponseSchema,
  CreateOrderInputSchema,
  SubstituteItemInputSchema,
  UpdateOrderStatusInputSchema,
  type Order,
  type OrderStatus,
  type FulfillmentType,
  type OrderItemStatus,
} from '@grocery/api-contracts';
import type { OrderWithItems } from './persistence/types.js';
import type { OrderService } from './service/types.js';
import {
  OrderDomainError,
  OrderNotFoundError,
  InvalidOrderStateTransitionError,
} from './service/errors.js';

const MAX_JSON_BODY_BYTES = 64 * 1024; // 64 KiB

export function toOrderDto(order: OrderWithItems): Order {
  return {
    id: order.id,
    storeId: order.store_id,
    customerId: order.customer_id ?? null,
    orderNumber: order.order_number,
    status: order.status as OrderStatus,
    fulfillmentType: order.fulfillment_type as FulfillmentType,
    deliveryAddress: order.delivery_address ?? null,
    customerPhone: order.customer_phone ?? null,
    customerName: order.customer_name ?? null,
    totalAmountCents: Number(order.total_amount_cents),
    currency: order.currency,
    notes: order.notes ?? null,
    items: order.items.map((it) => ({
      id: it.id,
      productId: it.product_id,
      productName: it.product_name_snapshot,
      sku: it.sku_snapshot ?? null,
      unit: it.unit_snapshot,
      unitPriceCents: Number(it.unit_price_cents),
      quantity: Number(it.quantity),
      totalPriceCents: Number(it.total_price_cents),
      status: it.status as OrderItemStatus,
      substitutedProductId: it.substituted_product_id ?? null,
      substitutionNotes: it.substitution_notes ?? null,
    })),
    createdAt: new Date(order.created_at).toISOString(),
    updatedAt: new Date(order.updated_at).toISOString(),
  };
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new OrderDomainError(
      'Content-Type must be application/json',
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
  }

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
          new OrderDomainError(
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
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const bodyStr = Buffer.concat(chunks).toString('utf-8');
        resolve(JSON.parse(bodyStr));
      } catch (err) {
        reject(new OrderDomainError('Malformed JSON payload', 400, 'MALFORMED_JSON'));
      }
    });

    req.on('error', (err) => {
      reject(new OrderDomainError(`Error reading request: ${err.message}`, 400, 'READ_ERROR'));
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

import type { InvoiceService } from './billing/invoice-service.js';

export interface OrderRoutesOptions {
  readonly orderService: OrderService;
  readonly invoiceService?: InvoiceService;
}

export function createOrderRoutes(options: OrderRoutesOptions): HttpRequestHandler {
  const { orderService, invoiceService } = options;

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
          service: 'order-service',
          status: 'operational',
          description: 'Order State Machine, Cart Lifecycle & Checkout Orchestration Service',
        });
        return;
      }

      // Require x-store-id for all domain API endpoints
      if (pathname.startsWith('/api/v1/orders')) {
        const enrichedReq = req as IncomingMessage & {
          internalToken?: { tid: string; roles: readonly string[] };
        };
        const headerStoreId =
          typeof req.headers['x-store-id'] === 'string'
            ? req.headers['x-store-id'].trim()
            : undefined;

        // Fail closed if explicit header contradicts authenticated token claim
        if (
          enrichedReq.internalToken &&
          headerStoreId &&
          headerStoreId !== enrichedReq.internalToken.tid
        ) {
          sendRfc7807(
            res,
            403,
            'Forbidden',
            'Tenant header x-store-id does not match authenticated token tenant claim',
            'TENANT_MISMATCH',
          );
          return;
        }

        const storeId = enrichedReq.internalToken?.tid ?? resolveStoreId(req, url);
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

        // POST /api/v1/orders - Create Order
        if (pathname === '/api/v1/orders' && method === 'POST') {
          const body = await readJsonBody(req);
          const parseResult = CreateOrderInputSchema.safeParse(body);
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

          const created = await orderService.createOrder({
            storeId,
            customerId: parseResult.data.customerId ?? null,
            fulfillmentType: parseResult.data.fulfillmentType,
            deliveryAddress: parseResult.data.deliveryAddress ?? null,
            customerPhone: parseResult.data.customerPhone ?? null,
            customerName: parseResult.data.customerName ?? null,
            notes: parseResult.data.notes ?? null,
            idempotencyKey: parseResult.data.idempotencyKey ?? null,
            items: parseResult.data.items,
          });

          sendJson(res, 201, { order: toOrderDto(created) });
          return;
        }

        // GET /api/v1/orders - List Orders
        if (pathname === '/api/v1/orders' && method === 'GET') {
          const limitStr = url.searchParams.get('limit');
          const offsetStr = url.searchParams.get('offset');
          const status = (url.searchParams.get('status') ?? undefined) as OrderStatus | undefined;
          const customerId = url.searchParams.get('customerId') ?? undefined;

          const limit = limitStr ? Math.max(1, Math.min(100, parseInt(limitStr, 10) || 20)) : 20;
          const offset = offsetStr ? Math.max(0, parseInt(offsetStr, 10) || 0) : 0;

          const result = await orderService.listOrders(storeId, {
            status,
            customerId,
            limit,
            offset,
          });

          sendJson(res, 200, {
            data: result.orders.map(toOrderDto),
            total: result.totalCount,
            limit,
            offset,
          });
          return;
        }

        // Route: /api/v1/orders/:id/*
        const orderIdMatch = pathname.match(/^\/api\/v1\/orders\/([^/]+)(.*)$/);
        if (orderIdMatch) {
          const orderId = orderIdMatch[1]!;
          const subPath = orderIdMatch[2]!;

          // GET /api/v1/orders/:id
          if (subPath === '' && method === 'GET') {
            const order = await orderService.getOrder(storeId, orderId);
            sendJson(res, 200, { order: toOrderDto(order) });
            return;
          }

          // GET /api/v1/orders/:id/history
          if (subPath === '/history' && method === 'GET') {
            const history = await orderService.getOrderHistory(storeId, orderId);
            sendJson(res, 200, {
              history: history.map((h) => ({
                id: h.id,
                orderId: h.order_id,
                storeId: h.store_id,
                fromStatus: h.from_status,
                toStatus: h.to_status,
                changedByUserId: h.changed_by_user_id,
                reason: h.reason,
                createdAt: new Date(h.created_at).toISOString(),
              })),
            });
            return;
          }

          // POST /api/v1/orders/:id/confirm
          if (subPath === '/confirm' && method === 'POST') {
            const body = (await readJsonBody(req)) as { userId?: string } | undefined;
            const confirmedByUserId = body?.userId ?? 'shopkeeper';

            const confirmed = await orderService.confirmOrder(storeId, orderId, confirmedByUserId);

            sendJson(res, 200, { order: toOrderDto(confirmed) });
            return;
          }

          // POST /api/v1/orders/:id/substitute
          if (subPath === '/substitute' && method === 'POST') {
            const body = (await readJsonBody(req)) as {
              itemId?: string;
              substitutedProductId?: string;
              substitutionNotes?: string;
              newQuantity?: number;
              userId?: string;
            };

            if (!body?.itemId || !body?.substitutedProductId) {
              sendRfc7807(
                res,
                400,
                'Validation Error',
                'itemId and substitutedProductId are required for item substitution',
                'VALIDATION_ERROR',
              );
              return;
            }

            const updated = await orderService.substituteItem({
              storeId,
              orderId,
              itemId: body.itemId,
              substitutedProductId: body.substitutedProductId,
              substitutionNotes: body.substitutionNotes,
              newQuantity: body.newQuantity,
              substitutedByUserId: body.userId ?? 'shopkeeper',
            });

            sendJson(res, 200, { order: toOrderDto(updated) });
            return;
          }

          // POST or PUT /api/v1/orders/:id/status
          if (subPath === '/status' && (method === 'POST' || method === 'PUT')) {
            const body = await readJsonBody(req);
            const parseResult = UpdateOrderStatusInputSchema.safeParse(body);
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

            const rawBody = body as { userId?: string } | undefined;
            const changedByUserId = rawBody?.userId ?? 'shopkeeper';

            const updated = await orderService.advanceOrderStatus(
              storeId,
              orderId,
              parseResult.data.status,
              changedByUserId,
              parseResult.data.reason,
            );

            sendJson(res, 200, { order: toOrderDto(updated) });
            return;
          }

          // POST /api/v1/orders/:id/cancel
          if (subPath === '/cancel' && method === 'POST') {
            const body = (await readJsonBody(req)) as
              { reason?: string; userId?: string } | undefined;
            const reason = body?.reason ?? 'Cancelled by request';
            const cancelledByUserId = body?.userId ?? 'customer';

            const cancelled = await orderService.cancelOrder(
              storeId,
              orderId,
              cancelledByUserId,
              reason,
            );

            sendJson(res, 200, { order: toOrderDto(cancelled) });
            return;
          }

          // POST /api/v1/orders/:id/invoice or /invoices
          if ((subPath === '/invoice' || subPath === '/invoices') && method === 'POST') {
            if (!invoiceService) {
              sendRfc7807(res, 501, 'Not Implemented', 'Invoice service is not configured', 'NOT_IMPLEMENTED');
              return;
            }
            const body = ((await readJsonBody(req).catch(() => ({}))) as { taxRateBasisPoints?: number }) ?? {};
            const result = await invoiceService.generateInvoice(storeId, orderId, body);
            sendJson(res, 201, {
              invoice: {
                ...result.invoice,
                subtotalMinor: result.invoice.subtotalMinor.toString(),
                taxTotalMinor: result.invoice.taxTotalMinor.toString(),
                grandTotalMinor: result.invoice.grandTotalMinor.toString(),
              },
              lines: result.lines.map((l) => ({
                ...l,
                unitPriceMinorSnapshot: l.unitPriceMinorSnapshot.toString(),
                taxAmountMinor: l.taxAmountMinor.toString(),
                lineTotalMinor: l.lineTotalMinor.toString(),
              })),
            });
            return;
          }

          // GET /api/v1/orders/:id/invoice or /invoices
          if ((subPath === '/invoice' || subPath === '/invoices') && method === 'GET') {
            if (!invoiceService) {
              sendRfc7807(res, 501, 'Not Implemented', 'Invoice service is not configured', 'NOT_IMPLEMENTED');
              return;
            }
            const result = await invoiceService.getInvoiceByOrderId(storeId, orderId);
            if (!result) {
              sendRfc7807(res, 404, 'Not Found', `No invoice found for order ${orderId}`, 'INVOICE_NOT_FOUND');
              return;
            }
            sendJson(res, 200, {
              invoice: {
                ...result.invoice,
                subtotalMinor: result.invoice.subtotalMinor.toString(),
                taxTotalMinor: result.invoice.taxTotalMinor.toString(),
                grandTotalMinor: result.invoice.grandTotalMinor.toString(),
              },
              lines: result.lines.map((l) => ({
                ...l,
                unitPriceMinorSnapshot: l.unitPriceMinorSnapshot.toString(),
                taxAmountMinor: l.taxAmountMinor.toString(),
                lineTotalMinor: l.lineTotalMinor.toString(),
              })),
            });
            return;
          }
        }
      }

      // Not found
      sendRfc7807(res, 404, 'Not Found', `Cannot ${method} ${pathname}`, 'NOT_FOUND');
    } catch (err) {
      if (err instanceof OrderDomainError) {
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
