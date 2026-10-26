import type { HttpServerOptions } from '@grocery/service-runtime';

export interface ServiceUrls {
  readonly identity: string;
  readonly catalog: string;
  readonly inventory: string;
  readonly order: string;
  readonly payment: string;
}

export interface ApiGatewayConfig {
  readonly port: number;
  readonly corsAllowedOrigins: readonly string[];
  readonly rateLimitWindowMs: number;
  readonly rateLimitMaxRequests: number;
  readonly internalTokenSecret: string;
  readonly serviceUrls: ServiceUrls;
}

export interface ApiGatewayOptions extends Partial<HttpServerOptions> {
  readonly corsAllowedOrigins?: readonly string[];
  readonly rateLimitWindowMs?: number;
  readonly rateLimitMaxRequests?: number;
  readonly internalTokenSecret?: string;
  readonly serviceUrls?: Partial<ServiceUrls>;
}
