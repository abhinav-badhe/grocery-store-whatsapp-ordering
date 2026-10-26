import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import {
  createHttpServer,
  type HttpServerInstance,
  type HttpServerOptions,
} from '@grocery/service-runtime';
import { renderStorefrontHtml, type StorefrontPageData } from './storefront/ui-template.js';
import {
  renderShopkeeperConsoleHtml,
  type ShopkeeperPageData,
} from './storefront/admin-template.js';

export * from './domain/index.js';
export * from './client/index.js';
export * from './storefront/index.js';

export interface WebServiceOptions extends Partial<HttpServerOptions> {
  readonly storeData?: StorefrontPageData;
  readonly adminData?: ShopkeeperPageData;
  readonly gatewayUrl?: string;
}

export const STOREFRONT_PRODUCT_IDS = {
  apple: '11111111-1111-4111-8111-000000000001',
  mango: '11111111-1111-4111-8111-000000000002',
  spinach: '11111111-1111-4111-8111-000000000003',
  tomatoes: '11111111-1111-4111-8111-000000000004',
  milk: '11111111-1111-4111-8111-000000000005',
  eggs: '11111111-1111-4111-8111-000000000006',
  butter: '11111111-1111-4111-8111-000000000007',
  yogurt: '11111111-1111-4111-8111-000000000008',
  rice: '11111111-1111-4111-8111-000000000009',
  flour: '11111111-1111-4111-8111-000000000010',
  oil: '11111111-1111-4111-8111-000000000011',
  coffee: '11111111-1111-4111-8111-000000000012',
} as const;

const DEFAULT_STORE_DATA: StorefrontPageData = {
  storeName: 'Local Corner Grocery',
  storeId: '00000000-0000-4000-8000-000000000001',
  phone: '+919876543210',
  address: 'Shop 4, Hill Road, Bandra West, Mumbai 400050',
  categories: [
    { id: 'cat-fresh-produce', name: 'Fresh Produce', icon: '🍎' },
    { id: 'cat-dairy', name: 'Dairy & Eggs', icon: '🥛' },
    { id: 'cat-staples', name: 'Grains & Staples', icon: '🌾' },
    { id: 'cat-beverages', name: 'Beverages', icon: '☕' },
  ],
  products: [
    {
      id: STOREFRONT_PRODUCT_IDS.apple,
      categoryId: 'cat-fresh-produce',
      name: 'Fresh Fuji Apples',
      priceCents: 14000n,
      originalPriceCents: 17500n,
      unit: 'KG',
      imageUrl:
        'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=500&q=80',
      badge: 'ORGANIC',
      description: 'Crisp, sweet, and hand-picked orchard-fresh Himalayan Fuji apples.',
    },
    {
      id: STOREFRONT_PRODUCT_IDS.mango,
      categoryId: 'cat-fresh-produce',
      name: 'Ratnagiri Alphonso Mangoes (1kg)',
      priceCents: 65000n,
      originalPriceCents: 80000n,
      unit: 'KG',
      imageUrl:
        'https://images.unsplash.com/photo-1553279768-865429fa0078?auto=format&fit=crop&w=500&q=80',
      badge: 'BESTSELLER',
      description: 'Naturally ripened GI-tagged Ratnagiri Hapus mangoes with rich aroma.',
    },
    {
      id: STOREFRONT_PRODUCT_IDS.spinach,
      categoryId: 'cat-fresh-produce',
      name: 'Hydroponic Baby Spinach (250g)',
      priceCents: 4500n,
      originalPriceCents: 6000n,
      unit: 'PACK',
      imageUrl:
        'https://images.unsplash.com/photo-1576045057995-568f588f82fb?auto=format&fit=crop&w=500&q=80',
      badge: 'FARM FRESH',
      description: 'Zero pesticides, harvested same morning for maximum nutrients.',
    },
    {
      id: STOREFRONT_PRODUCT_IDS.tomatoes,
      categoryId: 'cat-fresh-produce',
      name: 'Vine-Ripened Roma Tomatoes',
      priceCents: 3800n,
      originalPriceCents: 5000n,
      unit: 'KG',
      imageUrl:
        'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=500&q=80',
      badge: 'FRESH HARVEST',
      description: 'Firm, juicy, and ideal for curries, salads, and rich pasta sauces.',
    },
    {
      id: STOREFRONT_PRODUCT_IDS.milk,
      categoryId: 'cat-dairy',
      name: 'Organic Whole Milk 1L',
      priceCents: 6500n,
      originalPriceCents: 7500n,
      unit: 'LITRE',
      imageUrl:
        'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=500&q=80',
      badge: 'DAILY ESSENTIAL',
      description: 'Pure pasteurized whole milk from grass-fed cows. Chilled delivered.',
    },
    {
      id: STOREFRONT_PRODUCT_IDS.eggs,
      categoryId: 'cat-dairy',
      name: 'Farm Fresh Brown Eggs (Pack of 6)',
      priceCents: 6000n,
      originalPriceCents: 7500n,
      unit: 'PIECE',
      imageUrl:
        'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?auto=format&fit=crop&w=500&q=80',
      badge: 'FREE RANGE',
      description: 'Nutrient-rich golden yolk eggs from cage-free heritage hens.',
    },
    {
      id: STOREFRONT_PRODUCT_IDS.butter,
      categoryId: 'cat-dairy',
      name: 'Cultured Farmhouse Butter 500g',
      priceCents: 26500n,
      originalPriceCents: 29500n,
      unit: 'PACK',
      imageUrl:
        'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?auto=format&fit=crop&w=500&q=80',
      badge: 'ARTISANAL',
      description: 'Slow-churned salted butter with authentic creamy richness.',
    },
    {
      id: STOREFRONT_PRODUCT_IDS.yogurt,
      categoryId: 'cat-dairy',
      name: 'Artisanal Plain Greek Yogurt 400g',
      priceCents: 12000n,
      originalPriceCents: 14500n,
      unit: 'PACK',
      imageUrl:
        'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=500&q=80',
      badge: 'HIGH PROTEIN',
      description: 'Thick strained yogurt packed with gut-healthy live probiotic cultures.',
    },
    {
      id: STOREFRONT_PRODUCT_IDS.rice,
      categoryId: 'cat-staples',
      name: 'Premium Basmati Rice 5kg',
      priceCents: 45000n,
      originalPriceCents: 55000n,
      unit: 'PACK',
      imageUrl:
        'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=500&q=80',
      badge: 'AGED 2 YEARS',
      description: 'Extra-long aromatic pearls with delightful culinary fragrance.',
    },
    {
      id: STOREFRONT_PRODUCT_IDS.flour,
      categoryId: 'cat-staples',
      name: 'Stoneground Whole Wheat Atta 5kg',
      priceCents: 24000n,
      originalPriceCents: 28000n,
      unit: 'PACK',
      imageUrl:
        'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=500&q=80',
      badge: '100% SHARBATI',
      description: 'Traditional chakki fresh stoneground flour for soft rotis.',
    },
    {
      id: STOREFRONT_PRODUCT_IDS.oil,
      categoryId: 'cat-staples',
      name: 'Extra Virgin Olive Oil 500ml',
      priceCents: 52000n,
      originalPriceCents: 65000n,
      unit: 'PACK',
      imageUrl:
        'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=500&q=80',
      badge: 'COLD PRESSED',
      description: 'Rich Mediterranean single-estate unfiltered extra virgin olive oil.',
    },
    {
      id: STOREFRONT_PRODUCT_IDS.coffee,
      categoryId: 'cat-beverages',
      name: 'Roasted Arabica Coffee Beans 250g',
      priceCents: 38000n,
      originalPriceCents: 45000n,
      unit: 'PACK',
      imageUrl:
        'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?auto=format&fit=crop&w=500&q=80',
      badge: 'CHIKMAGALUR',
      description: 'Medium-dark roast with hazelnut and dark cocoa tasting notes.',
    },
  ],
};

const DEFAULT_ADMIN_DATA: ShopkeeperPageData = {
  storeName: 'Local Corner Grocery',
  storeId: '00000000-0000-4000-8000-000000000001',
  phone: '+919876543210',
  currency: 'INR',
  orders: [
    {
      id: '00000000-0000-4000-8000-000000001001',
      orderNumber: 'ORD-7821',
      customerName: 'Aarav Mehta',
      customerPhone: '+919820123456',
      deliveryAddress: 'Flat 402, Green Valley Apartments, Hill Road, Bandra West',
      channel: 'WHATSAPP',
      status: 'AWAITING_SHOPKEEPER_REVIEW',
      createdAt: new Date().toISOString(),
      items: [
        {
          id: '00000000-0000-4000-8000-000000000101',
          productId: STOREFRONT_PRODUCT_IDS.apple,
          productName: 'Fresh Fuji Apples',
          quantity: 1.0,
          unit: 'KG',
          unitPriceCents: 14000,
          totalPriceCents: 14000,
        },
        {
          id: '00000000-0000-4000-8000-000000000102',
          productId: STOREFRONT_PRODUCT_IDS.milk,
          productName: 'Organic Whole Milk 1L',
          quantity: 2.0,
          unit: 'LITRE',
          unitPriceCents: 6500,
          totalPriceCents: 13000,
        },
      ],
      subtotalCents: 27000,
      taxCents: 1350,
      deliveryFeeCents: 4000,
      totalCents: 32350,
      paymentStatus: 'UNPAID',
    },
    {
      id: '00000000-0000-4000-8000-000000001002',
      orderNumber: 'ORD-7820',
      customerName: 'Neha Sharma',
      customerPhone: '+919819876543',
      deliveryAddress: 'Bungalow 7, Perry Cross Road, Bandra West',
      channel: 'STOREFRONT',
      status: 'CONFIRMED',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      items: [
        {
          id: '00000000-0000-4000-8000-000000000103',
          productId: STOREFRONT_PRODUCT_IDS.rice,
          productName: 'Premium Basmati Rice 5kg',
          quantity: 1,
          unit: 'PACK',
          unitPriceCents: 45000,
          totalPriceCents: 45000,
        },
        {
          id: '00000000-0000-4000-8000-000000000104',
          productId: STOREFRONT_PRODUCT_IDS.eggs,
          productName: 'Farm Fresh Brown Eggs (Pack of 6)',
          quantity: 2,
          unit: 'PIECE',
          unitPriceCents: 6000,
          totalPriceCents: 12000,
        },
      ],
      subtotalCents: 57000,
      taxCents: 2850,
      deliveryFeeCents: 0,
      totalCents: 59850,
      paymentStatus: 'PAID',
    },
    {
      id: '00000000-0000-4000-8000-000000001003',
      orderNumber: 'ORD-7819',
      customerName: 'Kunal Kapoor',
      customerPhone: '+919870098765',
      deliveryAddress: 'Flat 12, Ocean View, Carter Road, Bandra West',
      channel: 'WHATSAPP',
      status: 'PREPARING',
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      items: [
        {
          id: '00000000-0000-4000-8000-000000000105',
          productId: STOREFRONT_PRODUCT_IDS.mango,
          productName: 'Ratnagiri Alphonso Mangoes (1kg)',
          quantity: 2,
          unit: 'KG',
          unitPriceCents: 65000,
          totalPriceCents: 130000,
        },
      ],
      subtotalCents: 130000,
      taxCents: 6500,
      deliveryFeeCents: 0,
      totalCents: 136500,
      paymentStatus: 'PAID',
    },
  ],
  inventory: [
    {
      productId: STOREFRONT_PRODUCT_IDS.apple,
      productName: 'Fresh Fuji Apples',
      category: 'Fresh Produce',
      unit: 'KG',
      onHand: 45,
      reserved: 5,
      available: 40,
      reorderLevel: 10,
      unitPriceCents: 14000,
    },
    {
      productId: STOREFRONT_PRODUCT_IDS.mango,
      productName: 'Ratnagiri Alphonso Mangoes (1kg)',
      category: 'Fresh Produce',
      unit: 'KG',
      onHand: 24,
      reserved: 4,
      available: 20,
      reorderLevel: 8,
      unitPriceCents: 65000,
    },
    {
      productId: STOREFRONT_PRODUCT_IDS.spinach,
      productName: 'Hydroponic Baby Spinach (250g)',
      category: 'Fresh Produce',
      unit: 'PACK',
      onHand: 15,
      reserved: 2,
      available: 13,
      reorderLevel: 5,
      unitPriceCents: 4500,
    },
    {
      productId: STOREFRONT_PRODUCT_IDS.milk,
      productName: 'Organic Whole Milk 1L',
      category: 'Dairy & Eggs',
      unit: 'LITRE',
      onHand: 60,
      reserved: 8,
      available: 52,
      reorderLevel: 15,
      unitPriceCents: 6500,
    },
    {
      productId: STOREFRONT_PRODUCT_IDS.eggs,
      productName: 'Farm Fresh Brown Eggs (Pack of 6)',
      category: 'Dairy & Eggs',
      unit: 'PIECE',
      onHand: 35,
      reserved: 6,
      available: 29,
      reorderLevel: 10,
      unitPriceCents: 6000,
    },
    {
      productId: STOREFRONT_PRODUCT_IDS.butter,
      productName: 'Cultured Farmhouse Butter 500g',
      category: 'Dairy & Eggs',
      unit: 'PACK',
      onHand: 18,
      reserved: 1,
      available: 17,
      reorderLevel: 5,
      unitPriceCents: 26500,
    },
    {
      productId: STOREFRONT_PRODUCT_IDS.rice,
      productName: 'Premium Basmati Rice 5kg',
      category: 'Grains & Staples',
      unit: 'PACK',
      onHand: 28,
      reserved: 3,
      available: 25,
      reorderLevel: 6,
      unitPriceCents: 45000,
    },
    {
      productId: STOREFRONT_PRODUCT_IDS.flour,
      productName: 'Stoneground Whole Wheat Atta 5kg',
      category: 'Grains & Staples',
      unit: 'PACK',
      onHand: 30,
      reserved: 2,
      available: 28,
      reorderLevel: 8,
      unitPriceCents: 24000,
    },
    {
      productId: STOREFRONT_PRODUCT_IDS.oil,
      productName: 'Extra Virgin Olive Oil 500ml',
      category: 'Grains & Staples',
      unit: 'PACK',
      onHand: 12,
      reserved: 1,
      available: 11,
      reorderLevel: 4,
      unitPriceCents: 38000,
    },
  ],
};

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]);

async function forwardToGateway(
  req: IncomingMessage,
  res: ServerResponse,
  gatewayUrl: string,
): Promise<void> {
  return new Promise((resolve) => {
    try {
      const parsedBase = new URL(gatewayUrl);
      const incomingUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const targetPath = `${incomingUrl.pathname}${incomingUrl.search}`;

      const forwardedHeaders: http.OutgoingHttpHeaders = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase()) && value !== undefined) {
          forwardedHeaders[key] = value;
        }
      }
      forwardedHeaders['x-forwarded-for'] = req.socket.remoteAddress ?? '127.0.0.1';
      forwardedHeaders['x-forwarded-proto'] = 'http';
      if (!forwardedHeaders['x-store-id']) {
        forwardedHeaders['x-store-id'] = '00000000-0000-4000-8000-000000000001';
      }

      const isHttps = parsedBase.protocol === 'https:';
      const requestFn = isHttps ? https.request : http.request;

      const proxyReq = requestFn(
        {
          protocol: parsedBase.protocol,
          hostname: parsedBase.hostname,
          port: parsedBase.port || (isHttps ? 443 : 80),
          path: targetPath,
          method: req.method,
          headers: forwardedHeaders,
          timeout: 15000,
        },
        (proxyRes) => {
          res.statusCode = proxyRes.statusCode ?? 500;
          for (const [key, value] of Object.entries(proxyRes.headers)) {
            if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase()) && value !== undefined) {
              res.setHeader(key, value);
            }
          }
          proxyRes.pipe(res);
          proxyRes.on('end', () => resolve());
          proxyRes.on('error', () => {
            if (!res.headersSent) {
              res.statusCode = 502;
              res.end(JSON.stringify({ status: 502, title: 'Bad Gateway' }));
            }
            resolve();
          });
        },
      );

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        if (!res.headersSent) {
          res.statusCode = 504;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ status: 504, title: 'Gateway Timeout' }));
        }
        resolve();
      });

      proxyReq.on('error', (err) => {
        if (!res.headersSent) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              type: 'https://tools.ietf.org/html/rfc7807',
              title: 'Bad Gateway',
              status: 502,
              detail: `Cannot connect to API Gateway at ${gatewayUrl}: ${err.message}`,
            }),
          );
        }
        resolve();
      });

      req.pipe(proxyReq);
    } catch (err: any) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            type: 'https://tools.ietf.org/html/rfc7807',
            title: 'Internal Server Error',
            status: 500,
            detail: err.message,
          }),
        );
      }
      resolve();
    }
  });
}

export function createWebService(options?: WebServiceOptions): HttpServerInstance {
  const storeData = options?.storeData ?? DEFAULT_STORE_DATA;
  const adminData = options?.adminData ?? DEFAULT_ADMIN_DATA;

  return createHttpServer({
    serviceName: 'web',
    ...options,
    requestHandler: async (req, res, context) => {
      if (options?.requestHandler) {
        await options.requestHandler(req, res, context);
        return;
      }

      const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = parsedUrl.pathname;

      // Pure JSON status inspection
      const acceptHeader = req.headers.accept ?? '';
      if (
        pathname === '/' &&
        acceptHeader.includes('application/json') &&
        !acceptHeader.includes('text/html')
      ) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            application: 'web',
            status: 'operational',
            description: 'Customer Storefront Frontend Service',
          }),
        );
        return;
      }

      // Storefront Customer Portal (HTML)
      if (pathname === '/' || pathname === '/catalog') {
        const html = renderStorefrontHtml(storeData);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.statusCode = 200;
        res.end(html);
        return;
      }

      // Shopkeeper & Admin Operations Console (HTML)
      if (pathname === '/admin' || pathname === '/shopkeeper') {
        const adminHtml = renderShopkeeperConsoleHtml(adminData);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.statusCode = 200;
        res.end(adminHtml);
        return;
      }

      // Forward API calls directly to API Gateway
      if (pathname.startsWith('/api/')) {
        const targetGateway =
          options?.gatewayUrl ?? process.env.API_GATEWAY_URL ?? 'http://127.0.0.1:3000';
        await forwardToGateway(req, res, targetGateway);
        return;
      }

      // 404 Route
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.statusCode = 404;
      res.end(
        JSON.stringify({
          type: 'https://tools.ietf.org/html/rfc7807',
          title: 'Not Found',
          status: 404,
          detail: `Cannot ${req.method} ${pathname}`,
        }),
      );
    },
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const service = createWebService();
  service.start().catch(() => {
    process.exit(1);
  });
}
