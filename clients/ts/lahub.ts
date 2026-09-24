/**
 * Minimal client for a laya-hub server (Node 18+, Deno, Bun, browsers*).
 *
 *   import { decide } from "./lahub";
 *   const result = await decide(
 *     { message: "I was charged twice, please refund me" },
 *     { refund: { type: "noul", instructions: "Does `message` ask for money back?" } },
 *     { baseUrl: "https://laya-api.example.com", apiKey: process.env.LAYA_HUB_KEY! },
 *   );
 *   console.log(result.answers.refund.noul);
 *
 * *Never ship an API key to a browser; call laya-hub from your server.
 */

export type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> | string[] }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string; criteria?: { false: string; true: string }; labels?: { false: string; true: string } };

export type Answer = {
  type: "choice" | "score" | "noul";
  choice?: string;
  score?: number;
  noul?: number;
  confidence: number;
  probabilities?: Record<string, number>;
  legend?: Record<string, string>;
  warning?: string;
};

export type DecideResult = {
  answers: Record<string, Answer>;
  routing: { model: string; served_by: string; reason: string; [k: string]: unknown };
  usage: { input_tokens: number; output_tokens: number };
  warning?: string;
};

export type ClientOptions = { baseUrl: string; apiKey: string; timeoutMs?: number };

export class LayaHubError extends Error {
  status: number;
  code: string;
  body: unknown;

  constructor(status: number, code: string, message: string, body?: unknown) {
    super(`${status} ${code}: ${message}`);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

async function post<T>(opts: ClientOptions, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${opts.baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new LayaHubError(res.status, data?.error?.code ?? "http_error", data?.error?.message ?? res.statusText, data);
  }
  return data as T;
}

/** Answer typed questions (choice / score / noul) about `state` in one call. */
export function decide(
  state: string | Record<string, unknown> | unknown[],
  questions: Record<string, Question>,
  opts: ClientOptions & { model?: string },
): Promise<DecideResult> {
  const { model, ...client } = opts;
  return post<DecideResult>(client, "/v1/systemone", model ? { state, questions, model } : { state, questions });
}

/** Run a preset question set: "triage" | "guard" | "moderation" | "router". */
export function preset(
  name: "triage" | "guard" | "moderation" | "router",
  state: string | Record<string, unknown>,
  opts: ClientOptions,
): Promise<DecideResult> {
  return post<DecideResult>(opts, `/v1/presets/${name}`, { state });
}
