import { z } from 'zod';
import { ENV } from '../config/env';
import { supabase } from '../lib/supabase';

export class ApiError extends Error {
  statusCode: number;
  data?: any;

  constructor(message: string, statusCode: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.data = data;
  }
}

interface FetchOptions extends RequestInit {
  schema?: z.ZodType<any, any>;
  skipAuth?: boolean;
  expectedUserId?: string;
}

let refreshInFlight: ReturnType<typeof supabase.auth.refreshSession> | null = null;

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', abort);
  const timer = setTimeout(abort, 15000);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}

let onUnauthorizedCallback: (() => void) | null = null;

export const setOnUnauthorizedCallback = (cb: (() => void) | null) => {
  onUnauthorizedCallback = cb;
};

/**
 * Centralized API client executing HTTP requests to the NestJS backend.
 * Injects Supabase JWT access token automatically into Authorization: Bearer <token>.
 * Validates responses against provided Zod schema.
 */
export async function apiFetch<T = any>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const { schema, skipAuth = false, expectedUserId, headers = {}, ...fetchOptions } = options;

  const url = `${ENV.API_BASE_URL.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string>),
  };

  let requestOwner: string | undefined;
  if (!skipAuth) {
    try {
      const { data } = await supabase.auth.getSession();
      requestOwner = data.session?.user.id;
      if (expectedUserId && expectedUserId !== requestOwner) throw new ApiError('Account changed; offline action paused', 409);
      const token = data.session?.access_token;
      if (token) {
        requestHeaders['Authorization'] = `Bearer ${token}`;
      }
    } catch (e) {
      throw e;
    }
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      ...fetchOptions,
      headers: requestHeaders,
    });
  } catch (netError: any) {
    throw new ApiError(
      netError?.message || 'Network connection error. Check your internet connection.',
      0
    );
  }

  if (response.status === 401 && !skipAuth) {
    refreshInFlight ??= supabase.auth.refreshSession().finally(() => { refreshInFlight = null; });
    const { data, error } = await refreshInFlight;
    if (error && (!error.status || error.status === 429 || error.status >= 500)) {
      throw new ApiError('Authentication service is temporarily unavailable', 503);
    }
    if (data.session && data.session.user.id === requestOwner) {
      response = await fetchWithTimeout(url, { ...fetchOptions, headers: { ...requestHeaders, Authorization: `Bearer ${data.session.access_token}` } });
    } else if (data.session) {
      throw new ApiError('Account changed; request paused', 409);
    }
    if (response.status === 401) {
      onUnauthorizedCallback?.();
      throw new ApiError('Session expired. Please log in again.', 401);
    }
  }

  // Parse JSON response body
  let responseBody: any = null;
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    try {
      responseBody = await response.json();
    } catch {
      responseBody = null;
    }
  } else {
    responseBody = await response.text();
  }

  // Handle 4xx / 5xx HTTP Errors
  if (!response.ok) {
    const errorMsg =
      (responseBody && (responseBody.message || responseBody.error)) ||
      `Server responded with status ${response.status}`;
    throw new ApiError(
      Array.isArray(errorMsg) ? errorMsg.join(', ') : String(errorMsg),
      response.status,
      responseBody
    );
  }

  // Validate with Zod schema if provided
  if (schema) {
    const parsed = schema.safeParse(responseBody);
    if (!parsed.success) {
      console.error(
        `[ApiClient] Schema validation error on ${endpoint}:`,
        parsed.error.format()
      );
      throw new ApiError(
        `Invalid server response format: ${parsed.error.issues[0]?.message || 'schema mismatch'}`,
        response.status,
        parsed.error
      );
    }
    return parsed.data as T;
  }

  return responseBody as T;
}

export const apiClient = {
  get: <T = any>(endpoint: string, options?: FetchOptions) =>
    apiFetch<T>(endpoint, { ...options, method: 'GET' }),

  post: <T = any>(endpoint: string, body?: any, options?: FetchOptions) =>
    apiFetch<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),

  put: <T = any>(endpoint: string, body?: any, options?: FetchOptions) =>
    apiFetch<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    }),

  patch: <T = any>(endpoint: string, body?: any, options?: FetchOptions) =>
    apiFetch<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: <T = any>(endpoint: string, options?: FetchOptions) =>
    apiFetch<T>(endpoint, { ...options, method: 'DELETE' }),
};
