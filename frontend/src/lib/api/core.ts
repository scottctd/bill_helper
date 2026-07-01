/**
 * CALLING SPEC:
 * - Purpose: provide the shared request layer for frontend API modules.
 * - Inputs: API path strings, request init objects, and auth token storage.
 * - Outputs: typed JSON responses, structured API errors, and shared auth/error helpers.
 * - Side effects: network requests and auth-token cleanup on unauthorized responses.
 */

import { clearStoredAuthToken, getStoredAuthToken } from "../../features/auth/storage";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function extractErrorMessage(body: string, status: number): string {
  if (!body) {
    return `Request failed (${status})`;
  }

  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return parsed.detail;
    }
  } catch {
    // Non-JSON error bodies fall back to raw text.
  }

  return body;
}

export function buildApiHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers ?? {});
  const token = getStoredAuthToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

export function getAuthTokenOrThrow(): string {
  const token = getStoredAuthToken();
  if (!token) {
    throw new Error("Log in before calling the API.");
  }
  return token;
}

export function createApiErrorFromResponse(body: string, status: number): ApiError {
  if (status === 401) {
    clearStoredAuthToken();
  }
  return new ApiError(extractErrorMessage(body, status), status);
}

export function throwApiErrorFromResponse(body: string, status: number): never {
  throw createApiErrorFromResponse(body, status);
}

export async function throwApiErrorFromFetchResponse(response: Response): Promise<never> {
  const body = await response.text();
  throwApiErrorFromResponse(body, response.status);
}

export function getApiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const message = error.message;
    switch (error.status) {
      case 403:
        return message ? `You don't have permission: ${message}` : "You don't have permission";
      case 404:
        return message ? `Not found: ${message}` : "Not found";
      case 409:
        return message ? `Conflict: ${message}` : "Conflict";
      case 422:
        return message;
      default:
        if (error.status >= 500) {
          return message ? `Server error: ${message}` : "Server error";
        }
        return message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = buildApiHeaders(init);
  const isFormData = init?.body instanceof FormData;
  if (!isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers,
    ...init
  });

  if (!response.ok) {
    await throwApiErrorFromFetchResponse(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  const headers = buildApiHeaders(init);
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers,
    ...init
  });

  if (!response.ok) {
    await throwApiErrorFromFetchResponse(response);
  }

  return await response.blob();
}

export function withApiBase(path: string): string {
  return `${API_BASE_URL}${path}`;
}
