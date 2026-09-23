import { Badge, Card, Empty, ErrorPanel, PageHeader, statusTone } from "@/components/ui";
import { getLogs, listKeys } from "@/lib/backend";
import { ms, utc } from "@/lib/format";
import { verifySession } from "@/lib/session";

const LIMITS = [50, 100, 250, 500];

export default async function LogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await verifySession();
  const sp = await searchParams;
  const limit = LIMITS.includes(Number(sp.limit)) ? Number(sp.limit) : 100;
  const keyId = /^\d+$/.test(String(sp.key ?? "")) ? Number(sp.key) : undefined;
  const [logs, keys] = await Promise.all([getLogs(limit, keyId).catch((e: Error) => e), listKeys().catch(() => [])]);

  return (
    <>
      <PageHeader title="Logs" description="Recent calls, newest first. Request bodies are not stored unless LOG_REQUEST_BODIES=true." />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="space-y-1">
          <span className="text-xs text-muted">Key</span>
          <select name="key" defaultValue={keyId ?? ""} className="input py-1.5">
            <option value="">All keys</option>
            {keys.map((k) => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Show</span>
          <select name="limit" defaultValue={limit} className="input py-1.5">
            {LIMITS.map((l) => (
              <option key={l} value={l}>{l} rows</option>
            ))}
          </select>
        </label>
        <button className="btn btn-sm">Apply</button>
      </form>
      <Card>
        {logs instanceof Error ? (
          <ErrorPanel message={logs.message} />
        ) : !logs.length ? (
          <Empty>No calls logged yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="p-2 font-medium">Time</th>
                  <th className="p-2 font-medium">Key</th>
                  <th className="p-2 font-medium">Endpoint</th>
                  <th className="p-2 font-medium">Status</th>
                  <th className="p-2 text-right font-medium">Latency</th>
                  <th className="p-2 font-medium">Model</th>
                  <th className="p-2 text-right font-medium">Questions</th>
                  <th className="p-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((r) => (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="whitespace-nowrap p-2 text-xs text-ink-2 tnum">{utc(r.created_at)}</td>
                    <td className="p-2">
                      {r.source === "playground" ? (
                        <span className="text-ink-2">playground</span>
                      ) : r.key_id === null ? (
                        <span className="text-muted">no key</span>
                      ) : (
                        r.key_name ?? <span className="text-muted">#{r.key_id} (deleted)</span>
                      )}
                    </td>
                    <td className="p-2 font-mono text-xs">{r.endpoint}</td>
                    <td className="p-2"><Badge tone={statusTone(r.status_code)}>{r.status_code}</Badge></td>
                    <td className="p-2 text-right tnum">{ms(r.latency_ms)}</td>
                    <td className="p-2 text-xs">{r.model ?? "–"}</td>
                    <td className="p-2 text-right tnum">{r.n_questions || "–"}</td>
                    <td className="max-w-md p-2 text-xs">
                      {r.warning && <div className="text-ink-2"><span aria-hidden>⚠ </span>{r.warning}</div>}
                      {r.error && <div className="break-words text-critical">{r.error}</div>}
                      {r.request_body && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-muted">Request body</summary>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-2 p-2 font-mono">{r.request_body}</pre>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
