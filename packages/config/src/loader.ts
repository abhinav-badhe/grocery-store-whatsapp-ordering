import type { z } from 'zod';

/**
 * Structured field validation failure detail.
 * Raw values are intentionally omitted to avoid leaking sensitive secrets in logs or stack traces.
 */
export interface ConfigFieldError {
  key: string;
  message: string;
}

/**
 * Configuration Validation Error.
 * Thrown when runtime environment validation fails.
 *
 * CRITICAL SECURITY INVARIANTS:
 * 1. This error formats failure reasons without echoing or logging supplied values.
 * 2. Zod error messages are sanitized: any reflected input values (such as from enum or custom
 *    refinement failures) are stripped or replaced with '[REDACTED]'.
 * 3. Serialized error representation (toJSON / JSON.stringify) contains only keys and sanitized messages.
 * 4. BOUNDARY LIMITATION: This error class protects configuration loading diagnostics.
 *    Downstream application services remain responsible for not logging secrets during domain processing.
 */
export class ConfigValidationError extends Error {
  public readonly fieldErrors: readonly ConfigFieldError[];

  constructor(fieldErrors: ConfigFieldError[]) {
    const formatted = fieldErrors.map((err) => `  - ${err.key}: ${err.message}`).join('\n');
    super(
      `Configuration validation failed with ${fieldErrors.length} error(s):\n${formatted}\n\n` +
        `Note: Supplied input values are omitted to prevent secret exposure.`,
    );
    this.name = 'ConfigValidationError';
    this.fieldErrors = Object.freeze([...fieldErrors]);
  }

  public toJSON() {
    return {
      name: this.name,
      message: this.message,
      fieldErrors: this.fieldErrors,
    };
  }
}

/**
 * Extracts a value at a given object path if it exists.
 * Supports string keys and numeric array indices.
 */
function getPathValue(obj: unknown, path: readonly (string | number)[]): unknown {
  let current: unknown = obj;
  for (const segment of path) {
    if (
      current !== null &&
      typeof current === 'object' &&
      segment in (current as Record<string | number, unknown>)
    ) {
      current = (current as Record<string | number, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Recursively extracts all leaf strings from an object or array.
 */
function collectAllLeafStrings(input: unknown, result: Set<string>, depth = 0): void {
  if (depth > 10 || input === null || input === undefined) {
    return;
  }
  if (typeof input === 'string') {
    if (input.length > 0) {
      result.add(input);
      const trimmed = input.trim();
      if (trimmed.length > 0) {
        result.add(trimmed);
      }
    }
    return;
  }
  if (typeof input === 'object') {
    if (Array.isArray(input)) {
      for (const item of input) {
        collectAllLeafStrings(item, result, depth + 1);
      }
    } else {
      for (const val of Object.values(input as Record<string, unknown>)) {
        collectAllLeafStrings(val, result, depth + 1);
      }
    }
  }
}

/**
 * Common benign environment words that should not be automatically redacted if they appear
 * in unrelated error messages (unless they were the exact value of the failing field).
 */
const COMMON_BENIGN_VALUES = new Set([
  'development',
  'test',
  'production',
  'true',
  'false',
  '0',
  '1',
  'info',
  'warn',
  'error',
  'debug',
  'trace',
  'fatal',
  'silent',
]);

/**
 * Collects all candidate strings that might represent supplied secret or sensitive inputs.
 * Failing field values are strictly prioritized and always included.
 */
function collectCandidateSecrets(
  sourceEnv: Record<string, unknown>,
  path: readonly (string | number)[],
  key: string,
): string[] {
  const failingFieldSecrets = new Set<string>();
  const ambientSecrets = new Set<string>();

  // 1. Value at the exact issue path
  const valFromPath = getPathValue(sourceEnv, path);
  collectAllLeafStrings(valFromPath, failingFieldSecrets);

  // 2. Value at dot-path key or underscore-path key
  if (key in sourceEnv) {
    collectAllLeafStrings(sourceEnv[key], failingFieldSecrets);
  }
  const underscoreKey = path.join('_');
  if (underscoreKey && underscoreKey in sourceEnv) {
    collectAllLeafStrings(sourceEnv[underscoreKey], failingFieldSecrets);
  }

  // 3. Ambient values from other parts of the environment
  collectAllLeafStrings(sourceEnv, ambientSecrets);

  // Combine: failing field values ALWAYS take priority and are ALWAYS redacted.
  const finalSecrets = new Set<string>(failingFieldSecrets);
  for (const s of ambientSecrets) {
    if (!COMMON_BENIGN_VALUES.has(s.toLowerCase())) {
      finalSecrets.add(s);
    }
  }

  // Sort descending by string length so that longer substrings are replaced before shorter substrings
  return Array.from(finalSecrets).sort((a, b) => b.length - a.length);
}

/**
 * Sanitizes Zod validation error messages to ensure supplied secret values are never echoed.
 *
 * Employs a fail-closed multi-layered defense:
 * 1. Controlled construction: standard Zod issue codes known to reflect input (such as invalid_enum_value)
 *    are constructed purely from controlled metadata rather than using Zod's default message.
 * 2. Reflection stripping: standard Zod reflection suffixes (", received ...") are stripped.
 * 3. Deep redaction: all candidate strings from the failing field path, its parent objects/arrays,
 *    and non-benign ambient environment values are replaced with '[REDACTED]'.
 * 4. Fallback: if after redaction the message is empty or whitespace, a safe rule-failure message is returned.
 */
function sanitizeErrorMessage(
  message: string,
  key: string,
  sourceEnv: Record<string, unknown>,
  issue: z.ZodIssue,
): string {
  let safeMessage: string;

  // 1. FAIL-CLOSED CONTROLLED MESSAGE GENERATION
  switch (issue.code) {
    case 'invalid_enum_value': {
      // Zod's default invalid_enum_value appends ", received '<input>'".
      // Controlled construction: only list allowed options without echoing what was received.
      const expected = (issue.options as (string | number)[])
        .map((opt) => `'${String(opt)}'`)
        .join(' | ');
      safeMessage = `Invalid enum value. Expected ${expected}`;
      break;
    }
    case 'invalid_literal': {
      safeMessage = `Invalid literal value. Expected ${JSON.stringify(issue.expected)}`;
      break;
    }
    default: {
      safeMessage = message;
      // Strip standard Zod reflection patterns like ", received '...'" or ", received "..." or ", received <val>"
      safeMessage = safeMessage.replace(/, received (?:'[^']*'|"[^"]*"|\S+)/g, '');
      break;
    }
  }

  // 2. REDACT ALL CANDIDATE SECRETS
  const candidateSecrets = collectCandidateSecrets(sourceEnv, issue.path, key);
  for (const secret of candidateSecrets) {
    if (safeMessage.includes(secret)) {
      safeMessage = safeMessage.replaceAll(secret, '[REDACTED]');
    }
  }

  // 3. FAIL-CLOSED FALLBACK
  const trimmed = safeMessage.trim();
  if (trimmed.length === 0 || trimmed === '[REDACTED]') {
    return `Validation rule failed for ${key}`;
  }

  return trimmed;
}

/**
 * Loads and validates environment configuration against a provided Zod schema.
 *
 * POLICY ON UNKNOWN ENVIRONMENT VARIABLES:
 * Production container hosts (Render, Vercel, Docker) inject numerous platform variables
 * (e.g., PATH, HOME, VERCEL_*, RENDER_*).
 * This loader TOLERATES and STRIPS unknown variables: only the keys declared in the schema
 * are validated and included in the resulting strongly typed configuration object.
 * Undeclared variables will not cause validation failures, are not mutated in sourceEnv,
 * and are safely omitted from the output.
 *
 * IMPORT-TIME SIDE EFFECT INVARIANT:
 * This function is executed explicitly during application startup (e.g. inside main() or server bootstrap).
 * Importing this package or schemas performs ZERO runtime side effects and does NOT access process.env.
 *
 * @param schema Zod schema defining the required and optional environment variables
 * @param sourceEnv Source environment dictionary (defaults to process.env)
 * @returns Fully validated and typed configuration object
 * @throws ConfigValidationError if any declared variable is missing or invalid
 */
export function loadConfig<T extends z.ZodTypeAny>(
  schema: T,
  sourceEnv: Record<string, unknown> = process.env,
): z.infer<T> {
  const result = schema.safeParse(sourceEnv);

  if (!result.success) {
    const fieldErrors: ConfigFieldError[] = result.error.issues.map((issue) => {
      const key = issue.path.join('.') || 'root';
      const sanitizedMessage = sanitizeErrorMessage(issue.message, key, sourceEnv, issue);
      return {
        key,
        message: sanitizedMessage,
      };
    });
    throw new ConfigValidationError(fieldErrors);
  }

  return result.data;
}
