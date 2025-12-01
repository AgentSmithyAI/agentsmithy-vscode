/**
 * Custom error class for API errors with structured data
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errors?: string[],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /**
   * Parse structured error response from server
   * Expected format: { detail: { message?: string, errors?: string[] } }
   */
  static fromResponse = (responseText: string, status: number): ApiError => {
    let errorMessage = `Request failed with status ${status}`;
    let errors: string[] | undefined;

    try {
      const data = JSON.parse(responseText) as unknown;
      const parsed = parseErrorDetail(data);
      if (parsed) {
        errorMessage = parsed.message;
        errors = parsed.errors;
      }
    } catch {
      // JSON parse failed, use default message
    }

    return new ApiError(errorMessage, status, errors);
  };
}

const parseErrorDetail = (data: unknown): {message: string; errors?: string[]} | null => {
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  const detail = (data as Record<string, unknown>).detail;
  if (typeof detail !== 'object' || detail === null) {
    return null;
  }

  const detailObj = detail as Record<string, unknown>;

  if (Array.isArray(detailObj.errors)) {
    const errArray = detailObj.errors.filter((e): e is string => typeof e === 'string');
    if (errArray.length > 0) {
      return {message: errArray.join('\n'), errors: errArray};
    }
  }

  if (typeof detailObj.message === 'string') {
    return {message: detailObj.message};
  }

  return null;
};
