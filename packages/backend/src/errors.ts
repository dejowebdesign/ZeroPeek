/**
 * Typed application errors.
 *
 * Routes throw these; the global error handler turns them into a JSON body of
 * the shape `{ error: { code, message, issues? } }`. Messages are safe to show
 * to the user – they never contain stack traces, SQL or secrets.
 */

/** HTTP status codes this application raises deliberately. */
export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500;

export class AppError extends Error {
  readonly status: ErrorStatus;
  readonly code: string;
  readonly issues?: Array<{ path: string; message: string }>;

  constructor(
    status: ErrorStatus,
    code: string,
    message: string,
    issues?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export const badRequest = (message: string, code = 'bad_request'): AppError =>
  new AppError(400, code, message);

export const unauthorized = (message = 'Authentication required.'): AppError =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = 'You are not allowed to do this.'): AppError =>
  new AppError(403, 'forbidden', message);

export const notFound = (message = 'Not found.'): AppError =>
  new AppError(404, 'not_found', message);

export const conflict = (message: string, code = 'conflict'): AppError =>
  new AppError(409, code, message);

export const invalid = (
  message: string,
  issues: Array<{ path: string; message: string }>,
): AppError => new AppError(422, 'invalid', message, issues);

export const tooManyRequests = (message = 'Too many requests.'): AppError =>
  new AppError(429, 'rate_limited', message);
