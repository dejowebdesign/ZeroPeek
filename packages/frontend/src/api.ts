/**
 * REST client.
 *
 * Thin wrapper over `fetch` that always sends cookies and echoes the CSRF
 * token on unsafe methods. The token is kept in memory only – it is fetched
 * from `GET /api/auth/me` after a page load and refreshed on login, so it is
 * never written to storage where a script could read it later.
 */

/** An error returned by the API, carrying the documented code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues?: Array<{ path: string; message: string }>;

  constructor(
    status: number,
    code: string,
    message: string,
    issues?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

let csrfToken = '';

/** Remember the CSRF token returned by login or `me`. */
export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export function getCsrfToken(): string {
  return csrfToken;
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Return the raw text instead of parsed JSON (used for CSV export). */
  raw?: boolean;
}

/** Perform an API request and return the parsed body. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (UNSAFE.has(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const response = await fetch(path, {
    method,
    headers,
    credentials: 'include',
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  if (options.raw) {
    if (!response.ok) throw await toError(response);
    return (await response.text()) as unknown as T;
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const error = payload as { error?: { code?: string; message?: string; issues?: [] } } | null;
    throw new ApiError(
      response.status,
      error?.error?.code ?? 'error',
      error?.error?.message ?? 'The request failed.',
      error?.error?.issues,
    );
  }
  return payload as T;
}

async function toError(response: Response): Promise<ApiError> {
  try {
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; issues?: [] };
    };
    return new ApiError(
      response.status,
      payload.error?.code ?? 'error',
      payload.error?.message ?? 'The request failed.',
      payload.error?.issues,
    );
  } catch {
    return new ApiError(response.status, 'error', 'The request failed.');
  }
}

/** Convenience helpers. */
export const get = <T>(path: string): Promise<T> => api<T>(path);
export const post = <T>(path: string, body?: unknown): Promise<T> =>
  api<T>(path, { method: 'POST', body });
export const put = <T>(path: string, body?: unknown): Promise<T> =>
  api<T>(path, { method: 'PUT', body });
export const del = <T>(path: string): Promise<T> => api<T>(path, { method: 'DELETE' });

/** Download a text response (CSV export) as a file. */
export async function download(path: string, filename: string): Promise<void> {
  const text = await api<string>(path, { raw: true });
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
