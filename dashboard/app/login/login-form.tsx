"use client";

import { useActionState } from "react";

import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium text-ink-2">
          Admin password
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required autoFocus className="input" />
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-critical">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
