import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

const COOKIE = "hub_session";
const MAX_AGE_S = 7 * 24 * 3600;

function secret(): string {
  // SESSION_SECRET is optional: by default it is derived from ADMIN_SECRET + ADMIN_PASSWORD, so
  // changing the password signs everyone out.
  const explicit = process.env.SESSION_SECRET;
  if (explicit) return explicit;
  return createHash("sha256")
    .update(`laya-hub-session:${process.env.ADMIN_SECRET ?? ""}:${process.env.ADMIN_PASSWORD ?? ""}`)
    .digest("hex");
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function passwordMatches(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false; // no password configured -> nobody can sign in
  return safeEqual(candidate, expected);
}

export async function createSession(): Promise<void> {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  const value = `${expires}.${sign(String(expires))}`;
  (await cookies()).set(COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

async function isValid(): Promise<boolean> {
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) return false;
  const [expires, mac] = value.split(".");
  if (!expires || !mac || !safeEqual(mac, sign(expires))) return false;
  return Number(expires) > Date.now() / 1000;
}

/** Call at the top of every protected page, layout and server action. */
export const verifySession = cache(async (): Promise<void> => {
  if (!(await isValid())) redirect("/login");
});
