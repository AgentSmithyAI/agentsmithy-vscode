/**
 * Type guard utilities for runtime type checking
 */

/**
 * Checks if value is a plain object (not null, not array)
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Checks if value is a string
 */
export const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * Checks if value is an Error instance
 */
export const isError = (value: unknown): value is Error => value instanceof Error;

/**
 * Checks if value has a message property
 */
export const hasMessage = (value: unknown): value is {message: string} =>
  value !== null &&
  value !== undefined &&
  typeof value === 'object' &&
  'message' in value &&
  typeof (value as {message: unknown}).message === 'string';

/**
 * Extracts error message from unknown error value
 */
export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (isError(error)) {
    return error.message;
  }
  if (hasMessage(error)) {
    return error.message;
  }
  return fallback;
};

/**
 * Checks if value is a boolean (strict check)
 */
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/**
 * Checks if value is a number
 */
export const isNumber = (value: unknown): value is number => typeof value === 'number';

/**
 * Safe JSON parse with type guard
 */
export const safeJsonParse = <T>(str: string): T | undefined => {
  try {
    return JSON.parse(str) as T;
  } catch {
    return undefined;
  }
};

