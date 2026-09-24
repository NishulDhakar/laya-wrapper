"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,

} from "recharts";

import { ms, nf, shortDate } from "@/lib/format";

type Day = { date: string; calls: number; errors: number; avg_latency_ms: number; p95_latency_ms: number };

const axis = { stroke: "var(--axis)", tick: { fill: "var(--muted)", fontSize: 12 }, tickLine: false };

function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <div className="mb-3 flex flex-wrap gap-4 text-xs text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={i.line ? "h-0.5 w-3 rounded-full" : "size-2.5 rounded-sm"}
            style={{ background: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function TipBox({ title, rows }: { title: string; rows: { label: string; value: string; color: string }[] }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-ink">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-sm" style={{ background: r.color }} />
            {r.label}
          </span>
          <span className="tnum font-medium text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Calls per day, split into successful calls and errors (stacked columns). */
export function CallsPerDayChart({ data }: { data: Day[] }) {
  const rows = data.map((d) => ({ ...d, ok: d.calls - d.errors, label: shortDate(d.date) }));
  return (
    <div>
      <Legend
        items={[
          { label: "Successful", color: "var(--series-1)" },
          { label: "Errors (4xx/5xx)", color: "var(--critical)" },
        ]}
      />
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={16} />
            <YAxis {...axis} axisLine={false} allowDecimals={false} tickFormatter={(v: number) => nf.format(v)} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof rows)[number];
                return (
                  <TipBox
                    title={shortDate(d.date)}
                    rows={[
                      { label: "Successful", value: nf.format(d.ok), color: "var(--series-1)" },
                      { label: "Errors", value: nf.format(d.errors), color: "var(--critical)" },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="ok" stackId="c" fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} maxBarSize={36} radius={[4, 4, 0, 0]} />
            <Bar dataKey="errors" stackId="c" fill="var(--critical)" stroke="var(--surface)" strokeWidth={2} maxBarSize={36} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Average and p95 latency per day (same unit, one axis). */
export function LatencyChart({ data }: { data: Day[] }) {
  // A day without calls has no latency: leave a gap instead of drawing a misleading 0 ms.
  const rows = data.map((d) => ({
    ...d,
    label: shortDate(d.date),
    avg: d.calls ? d.avg_latency_ms : null,
    p95: d.calls ? d.p95_latency_ms : null,
  }));
  const dot = { r: 4, strokeWidth: 2, stroke: "var(--surface)" };
  // A day with calls but no neighbours can't form a line segment, so mark it with a dot.
  const isolated = (i: number) => rows[i]?.calls > 0 && !rows[i - 1]?.calls && !rows[i + 1]?.calls;
  const loneDot = (color: string) =>
    function LoneDot(p: { cx?: number; cy?: number; index?: number }) {
      if (p.index === undefined || !isolated(p.index) || p.cx === undefined || p.cy === undefined) return <g key={p.index} />;
      return <circle key={p.index} cx={p.cx} cy={p.cy} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />;
    };
  return (
    <div>
      <Legend
        items={[
          { label: "Average", color: "var(--series-1)", line: true },
          { label: "p95", color: "var(--series-2)", line: true },
        ]}
      />
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -4 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={16} />
            <YAxis {...axis} axisLine={false} tickFormatter={(v: number) => (v === 0 ? "0" : ms(v))} width={64} />
            <Tooltip
              cursor={{ stroke: "var(--axis)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof rows)[number];
                if (!d.calls) return <TipBox title={shortDate(d.date)} rows={[{ label: "No calls", value: "", color: "var(--axis)" }]} />;
                return (
                  <TipBox
                    title={shortDate(d.date)}
                    rows={[
                      { label: "Average", value: ms(d.avg_latency_ms), color: "var(--series-1)" },
                      { label: "p95", value: ms(d.p95_latency_ms), color: "var(--series-2)" },
                    ]}
                  />
                );
              }}
            />
            <Line type="monotone" dataKey="avg" stroke="var(--series-1)" strokeWidth={2} dot={loneDot("var(--series-1)")} activeDot={dot} />
            <Line type="monotone" dataKey="p95" stroke="var(--series-2)" strokeWidth={2} dot={loneDot("var(--series-2)")} activeDot={dot} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Calls per key (horizontal bars, single series, value at the tip). Long tails fold into "Other". */
export function CallsPerKeyChart({ data }: { data: { name: string; calls: number }[] }) {
  const sorted = [...data].sort((a, b) => b.calls - a.calls);
  const top = sorted.slice(0, 8);
  const rest = sorted.slice(8).reduce((n, k) => n + k.calls, 0);
  if (rest > 0) top.push({ name: "Other", calls: rest });
  return (
    <div style={{ height: Math.max(120, top.length * 36 + 24) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={top} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" {...axis} axisLine={false} width={140} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof top)[number];
              return <TipBox title={d.name} rows={[{ label: "Calls", value: nf.format(d.calls), color: "var(--series-1)" }]} />;
            }}
          />
          <Bar dataKey="calls" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={22}>
            <LabelList dataKey="calls" position="right" fill="var(--ink-2)" fontSize={12} formatter={(v) => nf.format(Number(v))} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
