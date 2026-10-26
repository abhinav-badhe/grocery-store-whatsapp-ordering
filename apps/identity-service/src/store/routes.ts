import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpRequestHandler } from '@grocery/service-runtime';
import type { Logger, RequestContext } from '@grocery/observability';
import {
  CreateStoreResponseSchema,
  StoreResponseSchema,
  UserStoreListResponseSchema,
  StoreMembershipSchema,
} from '@grocery/api-contracts';
import type { StoreService } from './types.js';
import type { AuthService } from '../auth/types.js';
import { StoreError, StoreUnauthorizedError } from './errors.js';

const MAX_JSON_BODY_BYTES = 64 * 1024; // 64 KiB
const STORE_ID_REGEX = /^\/api\/v1\/stores\/([0-9a-f-]{36})$/i;
const STORE_MEMBERSHIPS_REGEX = /^\/api\/v1\/stores\/([0-9a-f-]{36})\/memberships$/i;

export interface StoreRouteOptions {
  readonly logger?: Logger;
  readonly authService?: AuthService;
  readonly getUserIdFromRequest?: (req: IncomingMessage) => Promise<string | null> | string | null;
}

export class PayloadTooLargeStoreError extends StoreError {
  public readonly statusCode = 413;
  public readonly title = 'Payload Too Large';

  constructor(detail = 'Request body exceeds maximum allowed size of 65536 bytes') {
    super(detail, 'PAYLOAD_TOO_LARGE');
  }
}

export class UnsupportedMediaTypeStoreError extends StoreError {
  public readonly statusCode = 415;
  public readonly title = 'Unsupported Media Type';

  constructor(detail = 'Content-Type must be application/json') {
    super(detail, 'UNSUPPORTED_MEDIA_TYPE');
  }
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new UnsupportedMediaTypeStoreError('Content-Type must be application/json');
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
        req.removeAllListeners('data');
        req.resume();
        reject(
          new PayloadTooLargeStoreError(
            `Request body exceeds maximum allowed size of ${maxBytes} bytes`,
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
        const text = Buffer.concat(chunks).toString('utf8');
        const parsed = JSON.parse(text);
        resolve(parsed);
      } catch {
        reject(new Error('Malformed JSON payload in request body'));
      }
    });

    req.on('error', (err) => {
      if (exceeded) return;
      reject(err);
    });
  });
}

function sendJsonResponse(res: ServerResponse, statusCode: number, data: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

/**
 * Creates an HTTP request handler for store and store membership endpoints.
 */
export function createStoreRequestHandler(
  storeService: StoreService,
  options?: StoreRouteOptions,
): HttpRequestHandler {
  const logger = options?.logger;
  const authService = options?.authService;
  const customGetUserId = options?.getUserIdFromRequest;

  async function resolveUserId(req: IncomingMessage): Promise<string | null> {
    if (customGetUserId) {
      return await customGetUserId(req);
    }

    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ') && authService) {
      const token = authHeader.slice(7).trim();
      try {
        const result = await authService.getCurrentUser(token);
        return result.user.id;
      } catch {
        return null;
      }
    }

    const xUserId = req.headers['x-user-id'];
    if (typeof xUserId === 'string' && xUserId.trim().length > 0) {
      return xUserId.trim();
    }

    return null;
  }

  return async (req: IncomingMessage, res: ServerResponse, context: RequestContext) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    try {
      // 1. POST /api/v1/stores (Create Store)
      if (method === 'POST' && pathname === '/api/v1/stores') {
        const userId = await resolveUserId(req);
        if (!userId) {
          throw new StoreUnauthorizedError('Authentication required to create a store');
        }

        const body = await readJsonBody(req);
        const result = await storeService.createStore(userId, body);
        const responsePayload = CreateStoreResponseSchema.parse(result);
        sendJsonResponse(res, 201, responsePayload);
        return;
      }

      // 2. GET /api/v1/users/me/stores (List Stores for Authenticated User)
      if (method === 'GET' && pathname === '/api/v1/users/me/stores') {
        const userId = await resolveUserId(req);
        if (!userId) {
          throw new StoreUnauthorizedError('Authentication required to list stores');
        }

        const stores = await storeService.listStoresForUser(userId);
        const responsePayload = UserStoreListResponseSchema.parse({ stores });
        sendJsonResponse(res, 200, responsePayload);
        return;
      }

      // 3. GET /api/v1/stores/:id (Store Lookup)
      const storeIdMatch = STORE_ID_REGEX.exec(pathname);
      if (method === 'GET' && storeIdMatch) {
        const storeId = storeIdMatch[1]!;
        const userId = (await resolveUserId(req)) ?? undefined;
        const store = await storeService.getStoreById(storeId, userId);
        const responsePayload = StoreResponseSchema.parse({ store });
        sendJsonResponse(res, 200, responsePayload);
        return;
      }

      // 4. POST /api/v1/stores/:id/memberships (Assign Membership)
      const membershipMatch = STORE_MEMBERSHIPS_REGEX.exec(pathname);
      if (method === 'POST' && membershipMatch) {
        const storeId = membershipMatch[1]!;
        const actingUserId = await resolveUserId(req);
        if (!actingUserId) {
          throw new StoreUnauthorizedError('Authentication required to manage store memberships');
        }

        const body = await readJsonBody(req);
        const membership = await storeService.assignMembership(actingUserId, storeId, body);
        const responsePayload = StoreMembershipSchema.parse(membership);
        sendJsonResponse(res, 200, responsePayload);
        return;
      }

      // 5. GET /api/v1/stores/:id/memberships (List Store Memberships)
      if (method === 'GET' && membershipMatch) {
        const storeId = membershipMatch[1]!;
        const actingUserId = await resolveUserId(req);
        if (!actingUserId) {
          throw new StoreUnauthorizedError('Authentication required to list store memberships');
        }

        const memberships = await storeService.listMemberships(actingUserId, storeId);
        sendJsonResponse(res, 200, { memberships });
        return;
      }

      // Not handled by store routes
      sendJsonResponse(res, 404, {
        type: 'https://tools.ietf.org/html/rfc7807',
        title: 'Not Found',
        status: 404,
        detail: `Cannot ${method} ${pathname}`,
      });
    } catch (err) {
      if (err instanceof StoreError) {
        sendJsonResponse(res, err.statusCode, err.toJSON());
        return;
      }

      logger?.error(
        { err, requestId: context.requestId },
        'Unhandled error in identity store request handler',
      );
      sendJsonResponse(res, 500, {
        type: 'https://tools.ietf.org/html/rfc7807',
        title: 'Internal Server Error',
        status: 500,
        detail: 'An unexpected internal error occurred',
        code: 'INTERNAL_ERROR',
      });
    }
  };
}
