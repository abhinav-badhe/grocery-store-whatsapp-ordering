import { z } from 'zod';

/**
 * Health Liveness Response Schema (/health/live).
 * Indicates whether the Node.js process is running and not locked in a deadlock.
 */
export const LivenessResponseSchema = z.object({
  status: z.enum(['ok', 'shutting_down']),
  timestamp: z.string().datetime(),
  uptime_seconds: z.number().nonnegative(),
});

export type LivenessResponse = z.infer<typeof LivenessResponseSchema>;

/**
 * Health Readiness Response Schema (/health/ready).
 * Indicates whether the service is ready to accept traffic (e.g. database connected, broker reachable).
 */
export const ReadinessResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  timestamp: z.string().datetime(),
  checks: z.record(z.string(), z.enum(['healthy', 'unhealthy'])),
});

export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
