import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Kysely } from 'kysely';
import { createDatabaseClient, type Database } from '@grocery/database';
import {
  createHttpServer,
  type HttpServerInstance,
  type HttpServerOptions,
} from '@grocery/service-runtime';
import { loadWhatsAppServiceConfig } from '@grocery/config';

import { DeterministicGroceryParser } from './parser/grocery-list-parser.js';
import { CatalogResolver } from './resolver/catalog-resolver.js';
import { QuoteGenerator } from './quote/quote-generator.js';
import { createQuoteRepository, type QuoteRepository } from './persistence/quote-repository.js';
import {
  createStoreChannelRepository,
  type StoreChannelRepository,
} from './persistence/store-channel-repository.js';
import {
  createInboundMessageRepository,
  type InboundMessageRepository,
} from './persistence/inbound-message-repository.js';
import {
  createConversationRepository,
  type ConversationRepository,
} from './persistence/conversation-repository.js';
import { HttpCatalogLookupClient, type CatalogLookupClient } from './clients/catalog-client.js';
import {
  HttpInventoryLookupClient,
  type InventoryLookupClient,
} from './clients/inventory-client.js';
import { HttpOrderLookupClient, type OrderLookupClient } from './clients/order-client.js';
import {
  HttpWhatsAppOutboundClient,
  type WhatsAppOutboundClient,
} from './clients/whatsapp-outbound-client.js';
import {
  ConversationCoordinator,
  createConversationCoordinator,
} from './coordinator/conversation-coordinator.js';
import { createWhatsAppRoutes } from './routes.js';

// Subphase 1: Grocery Parser
export { DeterministicGroceryParser } from './parser/grocery-list-parser.js';

// Subphase 2: Exact Money & Quantity Arithmetic
export {
  parseDecimalToMilliUnits,
  convertRequestedToMilliCatalogUnits,
  calculateLineTotalMinor,
  assertSafePostgresInt,
  POSTGRES_INT_MAX,
  ArithmeticOverflowError,
  InvalidQuantityFormatError,
} from './quote/money.js';

// Subphase 2: Internal HTTP Service Clients
export {
  HttpCatalogLookupClient,
  type CatalogLookupClient,
  CatalogClientError,
  type CatalogClientOptions,
} from './clients/catalog-client.js';

export {
  HttpInventoryLookupClient,
  type InventoryLookupClient,
  InventoryClientError,
  type InventoryClientOptions,
} from './clients/inventory-client.js';

// Subphase 2: Catalog & Stock Resolution
export { CatalogResolver, type CatalogResolverOptions } from './resolver/catalog-resolver.js';

// Subphase 2: Provisional Quote Generation
export {
  QuoteGenerator,
  type GenerateQuoteParams,
  DEFAULT_QUOTE_TTL_SECONDS,
} from './quote/quote-generator.js';

// Subphase 2: Quote Persistence & Monotonic Versioning
export {
  DefaultQuoteRepository,
  createQuoteRepository,
  type QuoteRepository,
  type SaveQuoteResult,
  ConversationNotFoundError,
} from './persistence/quote-repository.js';

// Subphase 3: Channel, Deduplication & Conversational Persistence
export {
  DefaultStoreChannelRepository,
  createStoreChannelRepository,
  type StoreChannelRepository,
} from './persistence/store-channel-repository.js';

export {
  DefaultInboundMessageRepository,
  createInboundMessageRepository,
  type InboundMessageRepository,
  type RecordInboundMessageInput,
  type RecordInboundResult,
} from './persistence/inbound-message-repository.js';

export {
  DefaultConversationRepository,
  createConversationRepository,
  type ConversationRepository,
} from './persistence/conversation-repository.js';

// Subphase 3: Outbound WhatsApp Client
export {
  HttpWhatsAppOutboundClient,
  type WhatsAppOutboundClient,
  type SendWhatsAppTextMessageParams,
  type SendWhatsAppButtonsParams,
  type SendWhatsAppButtonOption,
} from './clients/whatsapp-outbound-client.js';

// Subphase 3: Conversational Session Coordinator
export {
  ConversationCoordinator,
  createConversationCoordinator,
  type CoordinatorOptions,
  type ProcessInboundEventParams,
  type ProcessInboundResult,
} from './coordinator/conversation-coordinator.js';

// Subphase 4: Order Service Client
export {
  HttpOrderLookupClient,
  type OrderLookupClient,
  type CreateOrderFromQuoteParams,
  type OrderClientOptions,
} from './clients/order-client.js';

export interface WhatsAppServiceOptions extends Partial<HttpServerOptions> {
  readonly db?: Kysely<Database>;
  readonly coordinator?: ConversationCoordinator;
  readonly verifyToken?: string;
  readonly appSecret?: string;
  readonly catalogClient?: CatalogLookupClient;
  readonly inventoryClient?: InventoryLookupClient;
  readonly orderClient?: OrderLookupClient;
  readonly outboundClient?: WhatsAppOutboundClient;
}

export function createWhatsAppService(options?: WhatsAppServiceOptions): HttpServerInstance {
  let coordinator = options?.coordinator;

  if (!coordinator && options?.db) {
    const storeChannelRepo = createStoreChannelRepository(options.db);
    const inboundRepo = createInboundMessageRepository(options.db);
    const conversationRepo = createConversationRepository(options.db);
    const quoteRepo = createQuoteRepository(options.db);

    const catalogClient =
      options.catalogClient ??
      new HttpCatalogLookupClient({
        baseUrl: process.env.CATALOG_SERVICE_URL ?? 'http://127.0.0.1:3002',
        internalTokenSecret:
          process.env.INTERNAL_TOKEN_SECRET ?? 'default-secret-min-32-chars-long!!',
      });

    const inventoryClient =
      options.inventoryClient ??
      new HttpInventoryLookupClient({
        baseUrl: process.env.INVENTORY_SERVICE_URL ?? 'http://127.0.0.1:3003',
        internalTokenSecret:
          process.env.INTERNAL_TOKEN_SECRET ?? 'default-secret-min-32-chars-long!!',
      });

    const catalogResolver = new CatalogResolver({
      catalogClient,
      inventoryClient,
    });

    const outboundClient =
      options.outboundClient ??
      new HttpWhatsAppOutboundClient({
        apiToken: process.env.WHATSAPP_API_TOKEN ?? 'mock-token',
        baseUrl: process.env.WHATSAPP_API_BASE_URL ?? 'https://graph.facebook.com/v19.0',
      });

    const orderClient =
      options.orderClient ??
      new HttpOrderLookupClient({
        baseUrl: process.env.ORDER_SERVICE_URL ?? 'http://127.0.0.1:3004',
        internalTokenSecret:
          process.env.INTERNAL_TOKEN_SECRET ?? 'default-secret-min-32-chars-long!!',
      });

    coordinator = createConversationCoordinator({
      storeChannelRepo,
      inboundRepo,
      conversationRepo,
      quoteRepo,
      catalogResolver,
      outboundClient,
      orderClient,
    });
  }

  const verifyToken =
    options?.verifyToken ??
    process.env.WHATSAPP_VERIFY_TOKEN ??
    'grocery-whatsapp-verify-token-secret';
  const appSecret =
    options?.appSecret ?? process.env.WHATSAPP_APP_SECRET ?? 'grocery-meta-app-secret-32chars!';

  const routeHandler = coordinator
    ? createWhatsAppRoutes({
        coordinator,
        verifyToken,
        appSecret,
      })
    : undefined;

  return createHttpServer({
    serviceName: 'whatsapp-service',
    ...options,
    requestHandler: async (req, res, context) => {
      if (options?.requestHandler) {
        await options.requestHandler(req, res, context);
        return;
      }

      const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = parsedUrl.pathname;

      if (routeHandler && (pathname.startsWith('/api/v1/whatsapp') || pathname === '/webhook')) {
        await routeHandler(req, res, context);
        return;
      }

      if (pathname === '/') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            service: 'whatsapp-service',
            status: 'operational',
            description: 'WhatsApp Conversational Ordering & Webhook Ingress Service',
          }),
        );
        return;
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.statusCode = 404;
      res.end(
        JSON.stringify({
          type: 'https://tools.ietf.org/html/rfc7807',
          title: 'Not Found',
          status: 404,
          detail: `Cannot ${req.method} ${parsedUrl.pathname}`,
        }),
      );
    },
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const config = loadWhatsAppServiceConfig();
  let db: Kysely<Database> | undefined;
  if (process.env.DATABASE_URL) {
    const dbClient = createDatabaseClient<Database>({
      databaseUrl: process.env.DATABASE_URL,
      maxPoolSize: Number(process.env.DATABASE_MAX_POOL_SIZE || 5),
      connectionTimeoutMs: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS || 5000),
      idleTimeoutMs: Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 30000),
    });
    db = dbClient.db;
  }
  const service = createWhatsAppService({
    port: config.PORT,
    db,
    verifyToken: config.WHATSAPP_VERIFY_TOKEN,
    appSecret: config.WHATSAPP_APP_SECRET,
  });
  service.start().catch(() => {
    process.exit(1);
  });
}
