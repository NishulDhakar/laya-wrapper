import { CallsPerDayChart, LatencyChart } from "@/components/charts";
import { Badge, Card, ErrorPanel, PageHeader, StatTile } from "@/components/ui";
import { BackendError, getHealth, getUsage } from "@/lib/backend";
import { compact, ms, pct } from "@/lib/format";
import { verifySession } from "@/lib/session";

export default async function OverviewPage() {
  await verifySession();
  const [health, usage] = await Promise.all([getHealth(), getUsage({ days: 7 }).catch((e: BackendError) => e)]);

  const healthBadge = !health ? (
    <Badge tone="critical">Backend unreachable</Badge>
  ) : health.model_loaded ? (
    <Badge tone="good">Model loaded: {health.models.join(", ")}</Badge>
  ) : (
    <Badge tone="warning">Model loading…</Badge>
  );

  return (
    <>
      <PageHeader title="Overview" description="Last 7 days, UTC." actions={healthBadge} />
      {health && !health.model_loaded && health.error && (
        <div className="mb-4">
          <ErrorPanel title="Last model load attempt failed (retrying)" message={health.error} />
        </div>
      )}
      {usage instanceof Error ? (
        <ErrorPanel message={usage.message} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Calls today" value={compact(usage.today.calls)} hint={`${usage.today.errors} errors`} />
            <StatTile label="Calls, 7 days" value={compact(usage.totals.calls)} />
            <StatTile label="Average latency, 7 days" value={ms(usage.totals.avg_latency_ms)} hint={`p95 ${ms(usage.totals.p95_latency_ms)}`} />
            <StatTile label="Error rate, 7 days" value={pct(usage.totals.error_rate)} hint={`${usage.totals.errors} of ${usage.totals.calls} calls`} />
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Calls per day">
              <CallsPerDayChart data={usage.per_day} />
            </Card>
            <Card title="Latency per day" description="Includes errors; failed auth and validation are fast.">
              <LatencyChart data={usage.per_day} />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
