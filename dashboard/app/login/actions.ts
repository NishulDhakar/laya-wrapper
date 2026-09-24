"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createSession, destroySession, passwordMatches } from "@/lib/session";

// Simple in-memory brute-force brake: 10 failed attempts per IP per 15 minutes.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; resetAt: number }>();

async function clientIp(): Promise<string> {
  const h = await headers();
  // The proxy appends the real client IP last; earlier entries can be forged by the client.
  return h.get("x-forwarded-for")?.split(",").at(-1)?.trim() || h.get("x-real-ip") || "local";
}

export async function login(_: { error?: string } | undefined, form: FormData) {
  const ip = await clientIp();
  const now = Date.now();
  const entry = failures.get(ip);
  if (entry && entry.resetAt > now && entry.count >= MAX_FAILURES) {
    return { error: "Too many failed attempts. Try again in a few minutes." };
  }
  if (!process.env.ADMIN_PASSWORD) {
    return { error: "ADMIN_PASSWORD is not set on the server." };
  }
  if (!passwordMatches(String(form.get("password") ?? ""))) {
    const next = entry && entry.resetAt > now ? { ...entry, count: entry.count + 1 } : { count: 1, resetAt: now + WINDOW_MS };
    failures.set(ip, next);
    return { error: "Wrong password." };
  }
  failures.delete(ip);
  await createSession();
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
