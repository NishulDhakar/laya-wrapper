import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Card({ title, description, children, className = "" }: { title?: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-5 ${className}`}>
      {title && (
        <header className="mb-4">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-2">{hint}</div>}
    </div>
  );
}

/** Status is never color-alone: every badge carries a text label (and a dot). */
export function Badge({ tone, children }: { tone: "good" | "warning" | "critical" | "neutral"; children: ReactNode }) {
  const dot = { good: "bg-good", warning: "bg-warning", critical: "bg-critical", neutral: "bg-muted" }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-2">
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
      {children}
    </span>
  );
}

export function statusTone(code: number): "good" | "warning" | "critical" {
  if (code < 400) return "good";
  if (code < 500) return "warning";
  return "critical";
}

export function ErrorPanel({ title = "Could not reach the backend", message }: { title?: string; message: string }) {
  return (
    <div role="alert" className="rounded-xl border border-critical/40 bg-critical/5 p-4 text-sm">
      <div className="font-medium text-critical">{title}</div>
      <div className="mt-1 break-words text-ink-2">{message}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">{children}</div>;
}
