import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpRequestHandler } from '@grocery/service-runtime';
import type { RequestContext } from '@grocery/observability';
import {
  CategorySchema,
  CategoryResponseSchema,
  CategoryListResponseSchema,
  CreateCategoryInputSchema,
  UpdateCategoryInputSchema,
  ProductSchema,
  ProductResponseSchema,
  PaginatedProductListResponseSchema,
  CreateProductInputSchema,
  UpdateProductInputSchema,
  ProductListQuerySchema,
  type Category,
  type Product,
} from '@grocery/api-contracts';
import type { CategoryRow, ProductRow } from '@grocery/database';
import type { CatalogService } from './service/types.js';
import {
  CatalogDomainError,
  CategoryNotFoundError,
  ProductNotFoundError,
  InsufficientRoleError,
} from './service/errors.js';

const MAX_JSON_BODY_BYTES = 64 * 1024; // 64 KiB

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toCategoryDto(row: CategoryRow): Category {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    status: row.status as 'ACTIVE' | 'INACTIVE' | 'ARCHIVED',
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toProductDto(row: ProductRow): Product {
  return {
    id: row.id,
    storeId: row.store_id,
    categoryId: row.category_id,
    name: row.name,
    slug: row.slug,
    sku: row.sku,
    barcode: row.barcode,
    description: row.description,
    priceCents: Number(row.price_cents),
    currency: row.currency,
    unit: row.unit as 'PIECE' | 'KG' | 'GRAM' | 'LITRE' | 'MILLILITRE' | 'PACK' | 'DOZEN',
    isWeightBased: Boolean(row.is_weight_based),
    status: row.status as 'ACTIVE' | 'INACTIVE' | 'ARCHIVED',
    imageUrl: row.image_url,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new CatalogDomainError(
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
          new CatalogDomainError(
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
        reject(new CatalogDomainError('Malformed JSON in request body', 400, 'INVALID_JSON'));
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
  if (err instanceof CatalogDomainError) {
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

function assertCanMutateCatalog(roles?: readonly string[]): void {
  if (!roles || (!roles.includes('OWNER') && !roles.includes('MANAGER'))) {
    throw new InsufficientRoleError(['OWNER', 'MANAGER']);
  }
}

export interface CatalogRoutesOptions {
  readonly catalogService: CatalogService;
}

export function createCatalogRoutes(options: CatalogRoutesOptions): HttpRequestHandler {
  const { catalogService } = options;

  return async (req: IncomingMessage, res: ServerResponse, context: RequestContext) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method?.toUpperCase() ?? 'GET';

    // Store ID is injected from verified internal token claims (context.storeId)
    // or fallback to header 'x-store-id' if context is explicitly provided in tests
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

    const callerRoles = enrichedReq.internalToken?.roles ?? ['OWNER']; // default to OWNER if not set by middleware

    try {
      // -----------------------------------------------------------------------
      // Category Endpoints
      // -----------------------------------------------------------------------

      // POST /api/v1/catalog/categories
      if (method === 'POST' && pathname === '/api/v1/catalog/categories') {
        assertCanMutateCatalog(callerRoles);
        const body = await readJsonBody(req);
        const parsed = CreateCategoryInputSchema.safeParse(body);
        if (!parsed.success) {
          sendJson(res, 400, {
            type: 'https://tools.ietf.org/html/rfc7807',
            title: 'Bad Request',
            status: 400,
            detail: 'Validation failed for create category payload',
            code: 'VALIDATION_ERROR',
            invalid_params: parsed.error.issues.map((i) => ({
              name: i.path.join('.'),
              reason: i.message,
            })),
          });
          return;
        }

        const input = parsed.data;
        const slug = input.slug ? slugify(input.slug) : slugify(input.name);
        const created = await catalogService.createCategory(storeId, {
          name: input.name,
          slug,
          description: input.description,
          parentId: input.parentId,
          sortOrder: input.sortOrder,
        });

        const dto = toCategoryDto(created);
        CategoryResponseSchema.parse({ category: dto });
        sendJson(res, 201, { category: dto });
        return;
      }

      // GET /api/v1/catalog/categories
      if (method === 'GET' && pathname === '/api/v1/catalog/categories') {
        const parentIdParam = url.searchParams.get('parentId');
        const rootOnly = url.searchParams.get('root') === 'true';
        const statusParam = url.searchParams.get('status');

        let parentId: string | null | undefined = undefined;
        if (rootOnly) {
          parentId = null;
        } else if (parentIdParam !== null) {
          parentId = parentIdParam.length > 0 ? parentIdParam : null;
        }

        const categories = await catalogService.listCategories(storeId, {
          parentId,
          status: statusParam as 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' | undefined,
        });

        const dtos = categories.map(toCategoryDto);
        CategoryListResponseSchema.parse({ categories: dtos });
        sendJson(res, 200, { categories: dtos });
        return;
      }

      // GET /api/v1/catalog/categories/slug/:slug
      const categorySlugMatch = pathname.match(
        /^\/api\/v1\/catalog\/categories\/slug\/([a-z0-9-]+)$/,
      );
      if (method === 'GET' && categorySlugMatch) {
        const slug = categorySlugMatch[1];
        const category = await catalogService.getCategoryBySlug(storeId, slug);
        if (!category) {
          throw new CategoryNotFoundError(slug);
        }
        sendJson(res, 200, { category: toCategoryDto(category) });
        return;
      }

      // Match /api/v1/catalog/categories/:id
      const categoryIdMatch = pathname.match(
        /^\/api\/v1\/catalog\/categories\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
      );
      if (categoryIdMatch) {
        const categoryId = categoryIdMatch[1];

        if (method === 'GET') {
          const category = await catalogService.getCategoryById(storeId, categoryId);
          if (!category) {
            throw new CategoryNotFoundError(categoryId);
          }
          sendJson(res, 200, { category: toCategoryDto(category) });
          return;
        }

        if (method === 'PATCH') {
          assertCanMutateCatalog(callerRoles);
          const body = await readJsonBody(req);
          const parsed = UpdateCategoryInputSchema.safeParse(body);
          if (!parsed.success) {
            sendJson(res, 400, {
              type: 'https://tools.ietf.org/html/rfc7807',
              title: 'Bad Request',
              status: 400,
              detail: 'Validation failed for update category payload',
              code: 'VALIDATION_ERROR',
              invalid_params: parsed.error.issues.map((i) => ({
                name: i.path.join('.'),
                reason: i.message,
              })),
            });
            return;
          }

          const input = parsed.data;
          const updated = await catalogService.updateCategory(storeId, categoryId, {
            name: input.name,
            slug: input.slug ? slugify(input.slug) : undefined,
            description: input.description,
            parentId: input.parentId,
            sortOrder: input.sortOrder,
            status: input.status,
          });

          if (!updated) {
            throw new CategoryNotFoundError(categoryId);
          }
          sendJson(res, 200, { category: toCategoryDto(updated) });
          return;
        }

        if (method === 'DELETE') {
          assertCanMutateCatalog(callerRoles);
          const deleted = await catalogService.deleteCategory(storeId, categoryId);
          if (!deleted) {
            throw new CategoryNotFoundError(categoryId);
          }
          res.statusCode = 204;
          res.end();
          return;
        }
      }

      // -----------------------------------------------------------------------
      // Product Endpoints
      // -----------------------------------------------------------------------

      // POST /api/v1/catalog/products
      if (method === 'POST' && pathname === '/api/v1/catalog/products') {
        assertCanMutateCatalog(callerRoles);
        const body = await readJsonBody(req);
        const parsed = CreateProductInputSchema.safeParse(body);
        if (!parsed.success) {
          sendJson(res, 400, {
            type: 'https://tools.ietf.org/html/rfc7807',
            title: 'Bad Request',
            status: 400,
            detail: 'Validation failed for create product payload',
            code: 'VALIDATION_ERROR',
            invalid_params: parsed.error.issues.map((i) => ({
              name: i.path.join('.'),
              reason: i.message,
            })),
          });
          return;
        }

        const input = parsed.data;
        const slug = input.slug ? slugify(input.slug) : slugify(input.name);
        const created = await catalogService.createProduct(storeId, {
          name: input.name,
          slug,
          sku: input.sku,
          barcode: input.barcode,
          description: input.description,
          categoryId: input.categoryId,
          priceCents: input.priceCents,
          currency: input.currency,
          unit: input.unit,
          isWeightBased: input.isWeightBased,
          imageUrl: input.imageUrl,
        });

        const dto = toProductDto(created);
        ProductResponseSchema.parse({ product: dto });
        sendJson(res, 201, { product: dto });
        return;
      }

      // GET /api/v1/catalog/products
      if (method === 'GET' && pathname === '/api/v1/catalog/products') {
        const queryParams = {
          page: url.searchParams.get('page') ?? undefined,
          limit: url.searchParams.get('limit') ?? undefined,
          categoryId: url.searchParams.get('categoryId') ?? undefined,
          status: url.searchParams.get('status') ?? undefined,
          search: url.searchParams.get('search') ?? undefined,
        };

        const parsedQuery = ProductListQuerySchema.safeParse(queryParams);
        if (!parsedQuery.success) {
          sendJson(res, 400, {
            type: 'https://tools.ietf.org/html/rfc7807',
            title: 'Bad Request',
            status: 400,
            detail: 'Invalid query parameters for product listing',
            code: 'VALIDATION_ERROR',
            invalid_params: parsedQuery.error.issues.map((i) => ({
              name: i.path.join('.'),
              reason: i.message,
            })),
          });
          return;
        }

        const query = parsedQuery.data;
        const result = await catalogService.listProducts(storeId, query);
        const dtos = result.products.map(toProductDto);

        const totalPages = Math.ceil(result.total / query.limit);
        const responseData = {
          data: dtos,
          pagination: {
            page: query.page,
            limit: query.limit,
            total_items: result.total,
            total_pages: totalPages,
            has_next: query.page < totalPages,
            has_prev: query.page > 1,
          },
        };

        PaginatedProductListResponseSchema.parse(responseData);
        sendJson(res, 200, responseData);
        return;
      }

      // GET /api/v1/catalog/products/slug/:slug
      const productSlugMatch = pathname.match(/^\/api\/v1\/catalog\/products\/slug\/([a-z0-9-]+)$/);
      if (method === 'GET' && productSlugMatch) {
        const slug = productSlugMatch[1];
        const product = await catalogService.getProductBySlug(storeId, slug);
        if (!product) {
          throw new ProductNotFoundError(slug);
        }
        sendJson(res, 200, { product: toProductDto(product) });
        return;
      }

      // Match /api/v1/catalog/products/:id
      const productIdMatch = pathname.match(
        /^\/api\/v1\/catalog\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
      );
      if (productIdMatch) {
        const productId = productIdMatch[1];

        if (method === 'GET') {
          const product = await catalogService.getProductById(storeId, productId);
          if (!product) {
            throw new ProductNotFoundError(productId);
          }
          sendJson(res, 200, { product: toProductDto(product) });
          return;
        }

        if (method === 'PATCH') {
          assertCanMutateCatalog(callerRoles);
          const body = await readJsonBody(req);
          const parsed = UpdateProductInputSchema.safeParse(body);
          if (!parsed.success) {
            sendJson(res, 400, {
              type: 'https://tools.ietf.org/html/rfc7807',
              title: 'Bad Request',
              status: 400,
              detail: 'Validation failed for update product payload',
              code: 'VALIDATION_ERROR',
              invalid_params: parsed.error.issues.map((i) => ({
                name: i.path.join('.'),
                reason: i.message,
              })),
            });
            return;
          }

          const input = parsed.data;
          const updated = await catalogService.updateProduct(storeId, productId, {
            name: input.name,
            slug: input.slug ? slugify(input.slug) : undefined,
            sku: input.sku,
            barcode: input.barcode,
            description: input.description,
            categoryId: input.categoryId,
            priceCents: input.priceCents,
            currency: input.currency,
            unit: input.unit,
            isWeightBased: input.isWeightBased,
            status: input.status,
            imageUrl: input.imageUrl,
          });

          if (!updated) {
            throw new ProductNotFoundError(productId);
          }
          sendJson(res, 200, { product: toProductDto(updated) });
          return;
        }

        if (method === 'DELETE') {
          assertCanMutateCatalog(callerRoles);
          const deleted = await catalogService.deleteProduct(storeId, productId);
          if (!deleted) {
            throw new ProductNotFoundError(productId);
          }
          res.statusCode = 204;
          res.end();
          return;
        }
      }

      // Not found in catalog router
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
