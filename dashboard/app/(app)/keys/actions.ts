"use server";

import { refresh } from "next/cache";

import { createKey, deleteKey, updateKey } from "@/lib/backend";
import { verifySession } from "@/lib/session";

export type CreateState = { key?: string; name?: string; error?: string };
export type RowState = { error?: string } | undefined;

function parseLimit(raw: FormDataEntryValue | null): number | undefined | "invalid" {
  const s = String(raw ?? "").trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : "invalid";
}

export async function createKeyAction(_: CreateState, form: FormData): Promise<CreateState> {
  await verifySession();
  const name = String(form.get("name") ?? "").trim();
  const limit = parseLimit(form.get("rate_limit_per_min"));
  if (!name) return { error: "Give the key a name, e.g. the project or client it is for." };
  if (limit === "invalid") return { error: "Rate limit must be a whole number between 1 and 100000." };
  try {
    const created = await createKey(name, limit);
    refresh();
    return { key: created.key, name: created.name };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function updateKeyAction(_: RowState, form: FormData): Promise<RowState> {
  await verifySession();
  const id = Number(form.get("id"));
  const intent = String(form.get("intent"));
  try {
    if (intent === "toggle") {
      await updateKey(id, { is_active: form.get("is_active") !== "true" });
    } else if (intent === "delete") {
      await deleteKey(id);
    } else {
      const name = String(form.get("name") ?? "").trim();
      const limit = parseLimit(form.get("rate_limit_per_min"));
      if (!name) return { error: "Name can't be empty." };
      if (limit === "invalid" || limit === undefined) return { error: "Rate limit must be 1–100000." };
      await updateKey(id, { name, rate_limit_per_min: limit });
    }
    refresh();
    return undefined;
  } catch (e) {
    return { error: (e as Error).message };
  }
}
