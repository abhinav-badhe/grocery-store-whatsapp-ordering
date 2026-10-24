import {
  hash as defaultHash,
  verify as defaultVerify,
  parseOptions as defaultParseOptions,
  type Algorithm,
  type ParsedHashOptions,
} from '@node-rs/argon2';
import { Argon2idEnvSchema } from '@grocery/config';

/**
 * Numeric identifier for Argon2id per @node-rs/argon2 specification (Algorithm.Argon2id = 2).
 * Specified as a literal constant to comply with isolatedModules compiler requirements.
 */
const ARGON2ID_ALGORITHM: Algorithm = 2 as unknown as Algorithm;

/**
 * Optional dependencies for the Argon2id password hasher.
 * Enables deterministic testing and verification avoidance verification without monkey-patching ESM.
 */
export interface PasswordHasherDependencies {
  readonly hash?: typeof defaultHash;
  readonly verify?: typeof defaultVerify;
  readonly parseOptions?: typeof defaultParseOptions;
}

/**
 * Configuration options for the Argon2id password hasher.
 * Supports both camelCase programmatic options and uppercase environment variables.
 *
 * POLICY & PARAMETER UPGRADE GUIDANCE:
 * - Verification enforces conservative upper bounds on memoryCost, timeCost, and parallelism
 *   before native verification to eliminate resource exhaustion attacks via poisoned hashes.
 * - Upper bounds default to the hasher's configured costs (ADR-003 baseline: 65536 KiB, 3 passes, 4 threads).
 * - Future Parameter Upgrades:
 *   When bumping hashing parameters (e.g. upgrading memoryCost to 131072 KiB in future years),
 *   the new upper bound automatically accepts both new hashes and legacy lower-cost hashes (e.g. 65536 KiB).
 * - Downward Migration / Dual-Policy Scenarios:
 *   If hashing costs are ever lowered or if specific higher legacy bounds must be accommodated,
 *   explicit upper bounds (maxMemoryCost, maxTimeCost, maxParallelism) can be supplied.
 */
export interface PasswordHasherConfig {
  readonly memoryCost?: number;
  readonly timeCost?: number;
  readonly parallelism?: number;
  readonly ARGON2_MEMORY_COST?: number;
  readonly ARGON2_TIME_COST?: number;
  readonly ARGON2_PARALLELISM?: number;

  /**
   * Maximum allowed memory cost during verification (KiB).
   * Hashes with memory cost exceeding this threshold will be rejected before native verification.
   * Defaults to the hasher's configured memoryCost (ADR-003 baseline: 65536 KiB).
   */
  readonly maxMemoryCost?: number;

  /**
   * Maximum allowed time cost (iterations) during verification.
   * Hashes with time cost exceeding this threshold will be rejected before native verification.
   * Defaults to the hasher's configured timeCost (ADR-003 baseline: 3).
   */
  readonly maxTimeCost?: number;

  /**
   * Maximum allowed parallelism (threads) during verification.
   * Hashes with parallelism exceeding this threshold will be rejected before native verification.
   * Defaults to the hasher's configured parallelism (ADR-003 baseline: 4).
   */
  readonly maxParallelism?: number;
}

/**
 * Interface for password hashing and verification.
 */
export interface PasswordHasher {
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
  readonly maxMemoryCost: number;
  readonly maxTimeCost: number;
  readonly maxParallelism: number;
  hash(password: string): Promise<string>;
  verify(password: string, storedHash: string): Promise<boolean>;
}

/**
 * Thrown when password input fails validation bounds prior to hashing.
 * Designed to avoid leaking input contents.
 */
export class PasswordValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordValidationError';
  }
}

/**
 * Factory for creating an Argon2id password hasher instance.
 *
 * PARAMETERS & INVARIANTS:
 * - Standardizes on Argon2id per ADR-003 §5.2.
 * - Defaults: memoryCost = 65536 KiB (64 MiB), timeCost = 3 passes, parallelism = 4 threads.
 * - Validated using Argon2idEnvSchema from @grocery/config.
 * - Preserves submitted password content strictly without trimming, normalization, or logging.
 * - Rejects non-string inputs and bounds length between 8 and 128 characters before expensive hashing.
 * - Fails safely (returns false) on malformed, corrupted, or out-of-policy hashes without leaking internals.
 * - Validates stored hash algorithm and cost bounds BEFORE calling native verification.
 *
 * @param config Optional configuration overriding default parameters
 * @param dependencies Optional injectable cryptographic functions for testing
 */
export function createPasswordHasher(
  config?: PasswordHasherConfig,
  dependencies?: PasswordHasherDependencies,
): PasswordHasher {
  const parsed = Argon2idEnvSchema.parse({
    ARGON2_MEMORY_COST: config?.ARGON2_MEMORY_COST ?? config?.memoryCost,
    ARGON2_TIME_COST: config?.ARGON2_TIME_COST ?? config?.timeCost,
    ARGON2_PARALLELISM: config?.ARGON2_PARALLELISM ?? config?.parallelism,
  });

  const memoryCost = parsed.ARGON2_MEMORY_COST;
  const timeCost = parsed.ARGON2_TIME_COST;
  const parallelism = parsed.ARGON2_PARALLELISM;

  const maxMemoryCost = config?.maxMemoryCost ?? memoryCost;
  const maxTimeCost = config?.maxTimeCost ?? timeCost;
  const maxParallelism = config?.maxParallelism ?? parallelism;

  if (maxMemoryCost < 1024) {
    throw new Error('maxMemoryCost must be at least 1024 KiB');
  }
  if (maxTimeCost < 1) {
    throw new Error('maxTimeCost must be at least 1');
  }
  if (maxParallelism < 1) {
    throw new Error('maxParallelism must be at least 1');
  }

  const hashFn = dependencies?.hash ?? defaultHash;
  const verifyFn = dependencies?.verify ?? defaultVerify;
  const parseOptionsFn = dependencies?.parseOptions ?? defaultParseOptions;

  return {
    memoryCost,
    timeCost,
    parallelism,
    maxMemoryCost,
    maxTimeCost,
    maxParallelism,

    /**
     * Hashes a plain password using Argon2id with configured parameters.
     * Enforces length boundaries (8 to 128 characters) before hashing.
     */
    async hash(password: string): Promise<string> {
      if (typeof password !== 'string') {
        throw new PasswordValidationError('Password must be a string');
      }
      if (password.length < 8) {
        throw new PasswordValidationError('Password must be at least 8 characters long');
      }
      if (password.length > 128) {
        throw new PasswordValidationError('Password cannot exceed 128 characters');
      }

      return await hashFn(password, {
        memoryCost,
        timeCost,
        parallelism,
        algorithm: ARGON2ID_ALGORITHM,
      });
    },

    /**
     * Verifies a plain password against an encoded Argon2id hash.
     * Returns false if either input is invalid or verification fails.
     * Fails safely without throwing on malformed, unsupported, or out-of-policy hash strings.
     *
     * RESOURCE-EXHAUSTION PROTECTION:
     * Validates the PHC string header using parseOptions() and rejects any hash that uses an
     * unsupported algorithm or cost parameters exceeding the configured limits BEFORE invoking
     * native verify().
     */
    async verify(password: string, storedHash: string): Promise<boolean> {
      if (typeof password !== 'string' || typeof storedHash !== 'string') {
        return false;
      }
      if (password.length < 8 || password.length > 128) {
        return false;
      }
      if (storedHash.length === 0 || !storedHash.startsWith('$argon2id$')) {
        return false;
      }

      let parsedOptions: ParsedHashOptions;
      try {
        parsedOptions = parseOptionsFn(storedHash);
      } catch {
        // Safe fail-closed: return false on malformed or non-decodable PHC strings
        return false;
      }

      if (
        parsedOptions.algorithm !== ARGON2ID_ALGORITHM ||
        typeof parsedOptions.memoryCost !== 'number' ||
        parsedOptions.memoryCost <= 0 ||
        parsedOptions.memoryCost > maxMemoryCost ||
        typeof parsedOptions.timeCost !== 'number' ||
        parsedOptions.timeCost <= 0 ||
        parsedOptions.timeCost > maxTimeCost ||
        typeof parsedOptions.parallelism !== 'number' ||
        parsedOptions.parallelism <= 0 ||
        parsedOptions.parallelism > maxParallelism
      ) {
        // Safe fail-closed: reject unsupported algorithm or out-of-policy costs before expensive verification
        return false;
      }

      try {
        return await verifyFn(storedHash, password);
      } catch {
        // Safe fail-closed: return false without throwing or exposing internals
        return false;
      }
    },
  };
}
