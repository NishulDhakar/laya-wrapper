"use client";

import { useActionState, useState } from "react";

import { CopyButton } from "@/components/copy-button";
import { Badge, Empty } from "@/components/ui";
import { utc } from "@/lib/format";
import type { ApiKey } from "@/lib/types";

import { createKeyAction, updateKeyAction, type CreateState } from "./actions";

export function CreateKeyForm({ defaultLimit }: { defaultLimit: number }) {
  const [state, action, pending] = useActionState(createKeyAction, {} as CreateState);
  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-ink-2">Name (project or client)</span>
          <input name="name" required maxLength={100} placeholder="e.g. support-bot, acme-corp" className="input" />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-ink-2">Rate limit (requests/min)</span>
          <input name="rate_limit_per_min" type="number" min={1} max={100000} placeholder={String(defaultLimit)} className="input tnum" />
        </label>
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Creating…" : "Create key"}
        </button>
      </form>
      {state.error && <p role="alert" className="text-sm text-critical">{state.error}</p>}
      {state.key && (
        <div className="rounded-lg border border-warning/60 bg-warning/10 p-4">
          <div className="text-sm font-medium">Key for “{state.name}” — copy it now</div>
          <p className="mt-0.5 text-xs text-ink-2">
            This is the only time the full key is shown. Only its SHA-256 hash is stored, so it can&apos;t be recovered later.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm">{state.key}</code>
            <CopyButton text={state.key} label="Copy key" />
          </div>
        </div>
      )}
    </div>
  );
}

function KeyRow({ k }: { k: ApiKey }) {
  const [state, action, pending] = useActionState(updateKeyAction, undefined);
  const [editing, setEditing] = useState(false);
  return (
    <tr className="border-t border-line align-top">
      {editing ? (
        <td colSpan={6} className="p-3">
          <form
            action={async (fd) => {
              await action(fd);
              setEditing(false);
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <input type="hidden" name="id" value={k.id} />
            <input type="hidden" name="intent" value="edit" />
            <label className="space-y-1">
              <span className="text-xs text-muted">Name</span>
              <input name="name" defaultValue={k.name} required maxLength={100} className="input w-56" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted">Requests/min</span>
              <input name="rate_limit_per_min" type="number" min={1} max={100000} defaultValue={k.rate_limit_per_min} className="input tnum w-32" />
            </label>
            <button className="btn btn-primary btn-sm" disabled={pending}>Save</button>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </form>
        </td>
      ) : (
        <>
          <td className="p-3">
            <div className="font-medium">{k.name}</div>
            <code className="font-mono text-xs text-muted">{k.prefix}…</code>
            {state?.error && <div role="alert" className="mt-1 text-xs text-critical">{state.error}</div>}
          </td>
          <td className="p-3 tnum">{k.rate_limit_per_min}/min</td>
          <td className="p-3">{k.is_active ? <Badge tone="good">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</td>
          <td className="p-3 text-xs text-ink-2 tnum">{utc(k.created_at)}</td>
          <td className="p-3 text-xs text-ink-2 tnum">{utc(k.last_used_at)}</td>
          <td className="p-3">
            <div className="flex flex-wrap justify-end gap-1.5">
              <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>
              <form action={action}>
                <input type="hidden" name="id" value={k.id} />
                <input type="hidden" name="intent" value="toggle" />
                <input type="hidden" name="is_active" value={String(k.is_active)} />
                <button className="btn btn-sm" disabled={pending}>{k.is_active ? "Deactivate" : "Activate"}</button>
              </form>
              <form
                action={action}
                onSubmit={(e) => {
                  if (!confirm(`Delete key "${k.name}"? Apps using it will get 401 immediately. Its usage history is kept.`)) e.preventDefault();
                }}
              >
                <input type="hidden" name="id" value={k.id} />
                <input type="hidden" name="intent" value="delete" />
                <button className="btn btn-sm btn-danger" disabled={pending}>Delete</button>
              </form>
            </div>
          </td>
        </>
      )}
    </tr>
  );
}

export function KeysTable({ keys }: { keys: ApiKey[] }) {
  if (!keys.length) return <Empty>No API keys yet. Create one above for each project or client.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th className="p-3 font-medium">Name / key</th>
            <th className="p-3 font-medium">Rate limit</th>
            <th className="p-3 font-medium">Status</th>
            <th className="p-3 font-medium">Created</th>
            <th className="p-3 font-medium">Last used</th>
            <th className="p-3" />
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <KeyRow key={k.id} k={k} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
