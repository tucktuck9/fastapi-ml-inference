/**
 * Extract a safe error message string from an unknown caught error.
 *
 * @param error - The caught exception.
 * @returns A string error message.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'An unknown error occurred';
}
