import "server-only";

import type { ApiKey, Health, LogRow, Usage } from "./types";

// The dashboard talks to the backend over the internal Docker network only. The admin secret is
// read here, on the server, and is never sent to the browser.
const BACKEND_URL = (process.env.BACKEND_URL ?? "http://backend:8080").replace(/\/$/, "");

export class BackendError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Secret": process.env.ADMIN_SECRET ?? "",
        ...init.headers,
      },
    });
  } catch (err) {
    throw new BackendError(`backend unreachable at ${BACKEND_URL} (${(err as Error).message})`, 0);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.error?.message ?? `backend returned HTTP ${res.status}`;
    throw new BackendError(message, res.status, body);
  }
  return body as T;
}

export async function getHealth(): Promise<Health | null> {
  // /health answers 503 while the model loads; that is data here, not an error.
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
    return (await res.json()) as Health;
  } catch {
    return null;
  }
}

export const listKeys = () => call<ApiKey[]>("/admin/keys");

export const createKey = (name: string, rate_limit_per_min?: number) =>
  call<ApiKey & { key: string }>("/admin/keys", {
    method: "POST",
    body: JSON.stringify({ name, rate_limit_per_min }),
  });

export const updateKey = (id: number, patch: Partial<Pick<ApiKey, "name" | "is_active" | "rate_limit_per_min">>) =>
  call<ApiKey>(`/admin/keys/${id}`, { method: "PATCH", body: JSON.stringify(patch) });

export const deleteKey = (id: number) => call<void>(`/admin/keys/${id}`, { method: "DELETE" });

export function getUsage(range: { days?: number; start?: string; end?: string }) {
  const q = new URLSearchParams();
  if (range.start) q.set("start", range.start);
  if (range.end) q.set("end", range.end);
  if (!range.start && range.days) q.set("days", String(range.days));
  return call<Usage>(`/admin/usage?${q}`);
}

export function getLogs(limit: number, keyId?: number) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (keyId !== undefined) q.set("key_id", String(keyId));
  return call<LogRow[]>(`/admin/logs?${q}`);
}

/** Runs a prediction without an API key. Returns the raw status and body so the Playground can
 *  show validation errors (400/422) as they are. */
export async function runPlayground(payload: unknown): Promise<{ status: number; body: unknown }> {
  try {
    const body = await call<unknown>("/admin/playground", { method: "POST", body: JSON.stringify(payload) }, 120_000);
    return { status: 200, body };
  } catch (err) {
    if (err instanceof BackendError && err.status > 0) return { status: err.status, body: err.body };
    throw err;
  }
}
