import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Structured request and execution context.
 * Propagates correlation and identity context across asynchronous call chains
 * without manual parameter drilling.
 */
export interface RequestContext {
  /**
   * Unique identifier for the specific incoming HTTP request or message invocation.
   */
  readonly requestId?: string;

  /**
   * Distributed correlation identifier propagated across multi-service boundaries.
   */
  readonly correlationId?: string;

  /**
   * Optional tenant context for log enrichment (canonical RFC 4122 store UUID).
   */
  readonly storeId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs a synchronous or asynchronous callback within a request context.
 * Context is preserved across asynchronous operations and strictly isolated
 * from concurrent requests.
 *
 * @param context Request context values (requestId, correlationId, storeId)
 * @param callback Function to execute within context
 * @returns Result of the callback
 */
export function runWithContext<T>(context: RequestContext, callback: () => T): T {
  return storage.run(Object.freeze({ ...context }), callback);
}

/**
 * Safely retrieves the active request context.
 * Returns undefined if called outside of runWithContext.
 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
