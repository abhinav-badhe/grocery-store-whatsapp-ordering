import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpRequestHandler } from '@grocery/service-runtime';
import type { RequestContext } from '@grocery/observability';
import {
  StockBalanceSchema,
  StockBalanceResponseSchema,
  StockBalanceListResponseSchema,
  UpdateStockInputSchema,
  AdjustStockInputSchema,
  ReserveStockInputSchema,
  StockReservationResponseSchema,
  type StockBalance,
  type StockReservation,
} from '@grocery/api-contracts';
import type { StockBalanceRow } from '@grocery/database';
import type { StockReservationWithItems } from './persistence/types.js';
import type { InventoryService } from './service/types.js';
import {
  InventoryDomainError,
  StockBalanceNotFoundError,
  ReservationNotFoundError,
} from './service/errors.js';

const MAX_JSON_BODY_BYTES = 64 * 1024; // 64 KiB

function toStockBalanceDto(row: StockBalanceRow): StockBalance {
  return {
    id: row.id,
    storeId: row.store_id,
    productId: row.product_id,
    sku: row.sku,
    onHandQuantity: Number(row.on_hand_quantity),
    reservedQuantity: Number(row.reserved_quantity),
    availableQuantity: Number(row.available_quantity),
    reorderPoint: row.reorder_point !== null ? Number(row.reorder_point) : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toStockReservationDto(res: StockReservationWithItems): StockReservation {
  return {
    id: res.id,
    storeId: res.store_id,
    orderId: res.order_id,
    status: res.status as 'ACTIVE' | 'FULFILLED' | 'RELEASED' | 'EXPIRED',
    expiresAt: new Date(res.expires_at).toISOString(),
    items: res.items.map((i) => ({
      id: i.id,
      productId: i.product_id,
      quantity: Number(i.quantity),
    })),
    createdAt: new Date(res.created_at).toISOString(),
    updatedAt: new Date(res.updated_at).toISOString(),
  };
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new InventoryDomainError(
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
          new InventoryDomainError(
            `Request body exceeds maximum allowed size of ${maxBytes} bytes`,
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
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim().length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new InventoryDomainError('Malformed JSON in request body', 400, 'INVALID_JSON'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof InventoryDomainError) {
    sendJson(res, err.statusCode, err.toJSON());
    return;
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = 500;
  res.end(
    JSON.stringify({
      type: 'https://tools.ietf.org/html/rfc7807',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected internal error occurred',
      code: 'INTERNAL_SERVER_ERROR',
    }),
  );
}

export interface InventoryRoutesOptions {
  readonly inventoryService: InventoryService;
}

export function createInventoryRoutes(options: InventoryRoutesOptions): HttpRequestHandler {
  const { inventoryService } = options;

  return async (req: IncomingMessage, res: ServerResponse, context: RequestContext) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method?.toUpperCase() ?? 'GET';

    const enrichedContext = context as RequestContext & { storeId?: string };
    const enrichedReq = req as IncomingMessage & {
      internalToken?: { tid: string; roles: readonly string[] };
    };

    const headerStoreId =
      typeof req.headers['x-store-id'] === 'string' ? req.headers['x-store-id'] : undefined;

    // Fail closed if explicit header contradicts authenticated token claim
    if (
      enrichedReq.internalToken &&
      headerStoreId &&
      headerStoreId !== enrichedReq.internalToken.tid
    ) {
      sendJson(res, 403, {
        type: 'https://tools.ietf.org/html/rfc7807',
        title: 'Forbidden',
        status: 403,
        detail: 'Tenant header x-store-id does not match authenticated token tenant claim',
        code: 'TENANT_MISMATCH',
      });
      return;
    }

    const storeId = enrichedContext.storeId ?? enrichedReq.internalToken?.tid ?? headerStoreId;

    if (!storeId) {
      sendJson(res, 401, {
        type: 'https://tools.ietf.org/html/rfc7807',
        title: 'Unauthorized',
        status: 401,
        detail: 'Missing store tenant identification context',
        code: 'MISSING_TENANT_CONTEXT',
      });
      return;
    }

    try {
      // -----------------------------------------------------------------------
      // Stock Balance Endpoints
      // -----------------------------------------------------------------------

      // GET /api/v1/inventory/stocks
      if (method === 'GET' && pathname === '/api/v1/inventory/stocks') {
        const lowStockOnly = url.searchParams.get('lowStockOnly') === 'true';
        const limitParam = url.searchParams.get('limit');
        const offsetParam = url.searchParams.get('offset');

        const balances = await inventoryService.listStockBalances(storeId, {
          lowStockOnly,
          limit: limitParam ? Math.min(100, Math.max(1, Number(limitParam))) : undefined,
          offset: offsetParam ? Math.max(0, Number(offsetParam)) : undefined,
        });

        const dtos = balances.map(toStockBalanceDto);
        StockBalanceListResponseSchema.parse({ stocks: dtos });
        sendJson(res, 200, { stocks: dtos });
        return;
      }

      // Match /api/v1/inventory/stocks/:productId
      const stockProductMatch = pathname.match(
        /^\/api\/v1\/inventory\/stocks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
      );
      if (stockProductMatch) {
        const productId = stockProductMatch[1];

        // GET single stock balance
        if (method === 'GET') {
          const balance = await inventoryService.getStockBalance(storeId, productId);
          if (!balance) {
            throw new StockBalanceNotFoundError(productId);
          }
          const dto = toStockBalanceDto(balance);
          StockBalanceResponseSchema.parse({ stock: dto });
          sendJson(res, 200, { stock: dto });
          return;
        }

        // PUT update stock quantities (onHand, reorderPoint)
        if (method === 'PUT') {
          const body = await readJsonBody(req);
          const parsed = UpdateStockInputSchema.safeParse(body);
          if (!parsed.success) {
            sendJson(res, 400, {
              type: 'https://tools.ietf.org/html/rfc7807',
              title: 'Bad Request',
              status: 400,
              detail: 'Validation failed for update stock payload',
              code: 'VALIDATION_ERROR',
              invalid_params: parsed.error.issues.map((i) => ({
                name: i.path.join('.'),
                reason: i.message,
              })),
            });
            return;
          }

          const updated = await inventoryService.updateStockBalance(
            storeId,
            productId,
            parsed.data.onHandQuantity,
            parsed.data.reorderPoint,
          );
          const dto = toStockBalanceDto(updated);
          StockBalanceResponseSchema.parse({ stock: dto });
          sendJson(res, 200, { stock: dto });
          return;
        }
      }

      // POST /api/v1/inventory/stocks/:productId/adjust
      const stockAdjustMatch = pathname.match(
        /^\/api\/v1\/inventory\/stocks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/adjust$/i,
      );
      if (method === 'POST' && stockAdjustMatch) {
        const productId = stockAdjustMatch[1];
        const body = await readJsonBody(req);
        const parsed = AdjustStockInputSchema.safeParse(body);
        if (!parsed.success) {
          sendJson(res, 400, {
            type: 'https://tools.ietf.org/html/rfc7807',
            title: 'Bad Request',
            status: 400,
            detail: 'Validation failed for adjust stock payload',
            code: 'VALIDATION_ERROR',
            invalid_params: parsed.error.issues.map((i) => ({
              name: i.path.join('.'),
              reason: i.message,
            })),
          });
          return;
        }

        const adjusted = await inventoryService.adjustStock(storeId, productId, parsed.data);
        const dto = toStockBalanceDto(adjusted);
        StockBalanceResponseSchema.parse({ stock: dto });
        sendJson(res, 200, { stock: dto });
        return;
      }

      // GET /api/v1/inventory/stocks/:productId/movements
      const stockMovementsMatch = pathname.match(
        /^\/api\/v1\/inventory\/stocks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/movements$/i,
      );
      if (method === 'GET' && stockMovementsMatch) {
        const productId = stockMovementsMatch[1];
        const movements = await inventoryService.listMovements(storeId, productId, 50);
        sendJson(res, 200, { movements });
        return;
      }

      // -----------------------------------------------------------------------
      // Reservation Endpoints (ADR-007)
      // -----------------------------------------------------------------------

      // POST /api/v1/inventory/reservations (atomic multi-item reservation)
      if (method === 'POST' && pathname === '/api/v1/inventory/reservations') {
        const body = await readJsonBody(req);
        const parsed = ReserveStockInputSchema.safeParse(body);
        if (!parsed.success) {
          sendJson(res, 400, {
            type: 'https://tools.ietf.org/html/rfc7807',
            title: 'Bad Request',
            status: 400,
            detail: 'Validation failed for reserve stock payload',
            code: 'VALIDATION_ERROR',
            invalid_params: parsed.error.issues.map((i) => ({
              name: i.path.join('.'),
              reason: i.message,
            })),
          });
          return;
        }

        const reservation = await inventoryService.reserveStock(storeId, parsed.data);
        const dto = toStockReservationDto(reservation);
        StockReservationResponseSchema.parse({ reservation: dto });
        sendJson(res, 201, { reservation: dto });
        return;
      }

      // GET /api/v1/inventory/reservations/order/:orderId
      const getReservationMatch = pathname.match(
        /^\/api\/v1\/inventory\/reservations\/order\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
      );
      if (method === 'GET' && getReservationMatch) {
        const orderId = getReservationMatch[1];
        const reservation = await inventoryService.getReservationByOrderId(storeId, orderId);
        if (!reservation) {
          throw new ReservationNotFoundError(orderId);
        }
        const dto = toStockReservationDto(reservation);
        StockReservationResponseSchema.parse({ reservation: dto });
        sendJson(res, 200, { reservation: dto });
        return;
      }

      // POST /api/v1/inventory/reservations/order/:orderId/release (idempotent saga compensation)
      const releaseReservationMatch = pathname.match(
        /^\/api\/v1\/inventory\/reservations\/order\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/release$/i,
      );
      if (method === 'POST' && releaseReservationMatch) {
        const orderId = releaseReservationMatch[1];
        const released = await inventoryService.releaseReservation(storeId, orderId);
        if (!released) {
          throw new ReservationNotFoundError(orderId);
        }
        const dto = toStockReservationDto(released);
        StockReservationResponseSchema.parse({ reservation: dto });
        sendJson(res, 200, { reservation: dto });
        return;
      }

      // POST /api/v1/inventory/reservations/order/:orderId/fulfill (order completion deduction)
      const fulfillReservationMatch = pathname.match(
        /^\/api\/v1\/inventory\/reservations\/order\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/fulfill$/i,
      );
      if (method === 'POST' && fulfillReservationMatch) {
        const orderId = fulfillReservationMatch[1];
        const fulfilled = await inventoryService.fulfillReservation(storeId, orderId);
        if (!fulfilled) {
          throw new ReservationNotFoundError(orderId);
        }
        const dto = toStockReservationDto(fulfilled);
        StockReservationResponseSchema.parse({ reservation: dto });
        sendJson(res, 200, { reservation: dto });
        return;
      }

      // Not found in inventory router
      sendJson(res, 404, {
        type: 'https://tools.ietf.org/html/rfc7807',
        title: 'Not Found',
        status: 404,
        detail: `Cannot ${method} ${pathname}`,
        code: 'ROUTE_NOT_FOUND',
      });
    } catch (err) {
      sendError(res, err);
    }
  };
}
