import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createHttpServer,
  type HttpServerInstance,
  type HttpServerOptions,
} from '@grocery/service-runtime';

export function createInventoryService(options?: Partial<HttpServerOptions>): HttpServerInstance {
  return createHttpServer({
    serviceName: 'inventory-service',
    ...options,
    requestHandler: async (req, res, context) => {
      if (options?.requestHandler) {
        await options.requestHandler(req, res, context);
        return;
      }
      const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      if (parsedUrl.pathname === '/') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            service: 'inventory-service',
            status: 'operational',
            description: 'Inventory & Stock Balance Domain Service',
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
  const service = createInventoryService();
  service.start().catch(() => {
    process.exit(1);
  });
}
