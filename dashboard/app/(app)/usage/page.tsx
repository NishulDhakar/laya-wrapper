import Link from "next/link";

import { CallsPerDayChart, CallsPerKeyChart, LatencyChart } from "@/components/charts";
import { Card, Empty, ErrorPanel, PageHeader } from "@/components/ui";
import { getUsage } from "@/lib/backend";
import { ms, nf, pct } from "@/lib/format";
import { verifySession } from "@/lib/session";

const PRESETS = [7, 30, 90];
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function UsagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await verifySession();
  const sp = await searchParams;
  const start = isDate(sp.start) ? sp.start : undefined;
  const end = isDate(sp.end) ? sp.end : undefined;
  const days = PRESETS.includes(Number(sp.days)) ? Number(sp.days) : 7;
  const custom = Boolean(start);
  const usage = await getUsage(custom ? { start, end } : { days }).catch((e: Error) => e);

  return (
    <>
      <PageHeader title="Usage" description="Per-key calls, errors and latency. Dates are UTC." />
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="flex gap-1">
          {PRESETS.map((d) => (
            <Link key={d} href={`/usage?days=${d}`} className={`btn btn-sm ${!custom && days === d ? "border-accent text-accent" : ""}`}>
              Last {d} days
            </Link>
          ))}
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="text-xs text-muted">From</span>
            <input type="date" name="start" defaultValue={start ?? (usage instanceof Error ? "" : usage.start)} required className="input py-1.5" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted">To</span>
            <input type="date" name="end" defaultValue={end ?? (usage instanceof Error ? "" : usage.end)} className="input py-1.5" />
          </label>
          <button className="btn btn-sm">Apply</button>
        </form>
      </div>

      {usage instanceof Error ? (
        <ErrorPanel title="Could not load usage" message={usage.message} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Calls per day">
              <CallsPerDayChart data={usage.per_day} />
            </Card>
            <Card title="Latency per day">
              <LatencyChart data={usage.per_day} />
            </Card>
          </div>
          <Card title="Calls per key" description={`${usage.start} to ${usage.end}`}>
            {usage.per_key.length ? <CallsPerKeyChart data={usage.per_key} /> : <Empty>No calls in this range.</Empty>}
          </Card>
          <Card title="Per-key breakdown">
            {usage.per_key.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="p-3 font-medium">Key</th>
                      <th className="p-3 text-right font-medium">Calls</th>
                      <th className="p-3 text-right font-medium">Errors</th>
                      <th className="p-3 text-right font-medium">Error rate</th>
                      <th className="p-3 text-right font-medium">Avg latency</th>
                      <th className="p-3 text-right font-medium">p95 latency</th>
                    </tr>
                  </thead>
                  <tbody className="tnum">
                    {usage.per_key.map((k) => (
                      <tr key={`${k.source}-${k.key_id}`} className="border-t border-line">
                        <td className="p-3">
                          {k.key_id !== null ? (
                            <Link href={`/logs?key=${k.key_id}`} className="hover:underline">{k.name}</Link>
                          ) : (
                            <span className="text-ink-2">{k.name}</span>
                          )}
                        </td>
                        <td className="p-3 text-right">{nf.format(k.calls)}</td>
                        <td className="p-3 text-right">{nf.format(k.errors)}</td>
                        <td className="p-3 text-right">{pct(k.error_rate)}</td>
                        <td className="p-3 text-right">{ms(k.avg_latency_ms)}</td>
                        <td className="p-3 text-right">{ms(k.p95_latency_ms)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="tnum font-medium">
                    <tr className="border-t border-line">
                      <td className="p-3">Total</td>
                      <td className="p-3 text-right">{nf.format(usage.totals.calls)}</td>
                      <td className="p-3 text-right">{nf.format(usage.totals.errors)}</td>
                      <td className="p-3 text-right">{pct(usage.totals.error_rate)}</td>
                      <td className="p-3 text-right">{ms(usage.totals.avg_latency_ms)}</td>
                      <td className="p-3 text-right">{ms(usage.totals.p95_latency_ms)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <Empty>No calls in this range.</Empty>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
