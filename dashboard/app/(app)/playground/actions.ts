"use server";

import { runPlayground } from "@/lib/backend";
import { verifySession } from "@/lib/session";

export type RunResult = { status: number; body: unknown; ms: number } | { status: 0; body: { error: { message: string } }; ms: number };

export async function runPrediction(payload: unknown): Promise<RunResult> {
  await verifySession();
  const started = Date.now();
  try {
    const { status, body } = await runPlayground(payload);
    return { status, body, ms: Date.now() - started };
  } catch (e) {
    return { status: 0, body: { error: { message: (e as Error).message } }, ms: Date.now() - started };
  }
}
