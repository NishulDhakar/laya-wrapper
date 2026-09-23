"use client";

import { useState, useTransition } from "react";

import { CopyButton } from "@/components/copy-button";
import { Badge, Card, statusTone } from "@/components/ui";

import { runPrediction, type RunResult } from "./actions";
import { blankQuestion, hints, MAX_CHOICE_OPTIONS, toPayload, type Draft, type DraftQuestion, type QType } from "./model";
import { TEMPLATES } from "./templates";

const TYPE_LABEL: Record<QType, string> = { choice: "Choice", score: "Score", noul: "Yes/no (noul)" };

// ------------------------------------------------------------------ builder

function QuestionEditor({ q, onChange, onRemove }: { q: DraftQuestion; onChange: (q: DraftQuestion) => void; onRemove: () => void }) {
  const set = (patch: Partial<DraftQuestion>) => onChange({ ...q, ...patch });
  return (
    <div className="space-y-3 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-40 flex-1 space-y-1">
          <span className="text-xs text-muted">Name</span>
          <input value={q.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. is_urgent" className="input font-mono" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Type</span>
          <select value={q.type} onChange={(e) => set({ type: e.target.value as QType })} className="input">
            {(Object.keys(TYPE_LABEL) as QType[]).map((t) => (
              <option key={t} value={t}>{TYPE_LABEL[t]}</option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-sm btn-danger" onClick={onRemove} aria-label={`Remove question ${q.name}`}>
          Remove
        </button>
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-muted">Instructions (refer to state keys in backticks, e.g. `message`)</span>
        <input value={q.instructions} onChange={(e) => set({ instructions: e.target.value })} className="input" />
      </label>

      {q.type === "choice" && (
        <div className="space-y-2">
          <span className="text-xs text-muted">Options (label → optional description), up to {MAX_CHOICE_OPTIONS}</span>
          {q.options.map((o, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={o.label}
                onChange={(e) => set({ options: q.options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                placeholder="label"
                className="input w-40 font-mono"
                aria-label={`Option ${i + 1} label`}
              />
              <input
                value={o.description}
                onChange={(e) => set({ options: q.options.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })}
                placeholder="what this option means"
                className="input"
                aria-label={`Option ${i + 1} description`}
              />
              <button type="button" className="btn btn-sm" disabled={q.options.length <= 2} onClick={() => set({ options: q.options.filter((_, j) => j !== i) })} aria-label="Remove option">
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-sm" disabled={q.options.length >= MAX_CHOICE_OPTIONS} onClick={() => set({ options: [...q.options, { label: "", description: "" }] })}>
            + Option
          </button>
        </div>
      )}

      {q.type === "score" && (
        <div className="space-y-2">
          <span className="text-xs text-muted">Levels, lowest first</span>
          {q.levels.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 text-right text-xs text-muted tnum">{i}</span>
              <input value={l} onChange={(e) => set({ levels: q.levels.map((x, j) => (j === i ? e.target.value : x)) })} className="input" aria-label={`Level ${i}`} />
              <button type="button" className="btn btn-sm" disabled={q.levels.length <= 2} onClick={() => set({ levels: q.levels.filter((_, j) => j !== i) })} aria-label="Remove level">
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => set({ levels: [...q.levels, ""] })}>
            + Level
          </button>
        </div>
      )}

      {q.type === "noul" && (
        <details className="text-sm" open={Boolean(q.noulFalse || q.noulTrue || q.labelFalse || q.labelTrue)}>
          <summary className="cursor-pointer text-xs text-muted">Optional: describe false/true and rename the labels</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input value={q.noulFalse} onChange={(e) => set({ noulFalse: e.target.value })} placeholder="false means…" className="input" aria-label="False description" />
            <input value={q.noulTrue} onChange={(e) => set({ noulTrue: e.target.value })} placeholder="true means…" className="input" aria-label="True description" />
            <input value={q.labelFalse} onChange={(e) => set({ labelFalse: e.target.value })} placeholder="label for false (e.g. no)" className="input" aria-label="False label" />
            <input value={q.labelTrue} onChange={(e) => set({ labelTrue: e.target.value })} placeholder="label for true (e.g. yes)" className="input" aria-label="True label" />
          </div>
        </details>
      )}

      {hints(q).map((h) => (
        <p key={h} className="rounded-md bg-warning/10 px-2 py-1.5 text-xs text-ink-2">
          <span aria-hidden>⚠ </span>
          {h}
        </p>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ results

function Bar({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr_3.5rem] items-center gap-2 text-sm">
      <span className={`truncate ${strong ? "font-semibold" : "text-ink-2"}`} title={label}>
        {strong && <span aria-hidden>✓ </span>}
        {label}
      </span>
      <span className="h-2 overflow-hidden rounded-full bg-surface-2">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      </span>
      <span className="text-right text-xs tnum">{(value * 100).toFixed(1)}%</span>
    </div>
  );
}

type Answer = {
  type: QType;
  choice?: string;
  score?: number;
  noul?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
  legend?: Record<string, string>;
  warning?: string;
};

function AnswerCard({ name, a, labels }: { name: string; a: Answer; labels?: { false: string; true: string } }) {
  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-sm font-medium">{name}</span>
        <span className="text-xs text-muted">
          {TYPE_LABEL[a.type]} · confidence <span className="tnum text-ink">{((a.confidence ?? 0) * 100).toFixed(1)}%</span>
        </span>
      </div>
      {a.type === "choice" &&
        Object.entries(a.probabilities ?? {}).map(([k, p]) => <Bar key={k} label={k} value={p} strong={k === a.choice} />)}
      {a.type === "score" && (
        <>
          <div className="text-sm">
            Expected score <span className="font-semibold tnum">{a.score?.toFixed(2)}</span>
            <span className="text-muted"> of {Object.keys(a.legend ?? {}).length - 1}</span>
          </div>
          {Object.entries(a.probabilities ?? {}).map(([k, p]) => (
            <Bar key={k} label={`${k}: ${a.legend?.[k] ?? ""}`} value={p} strong={Math.round(a.score ?? -1) === Number(k)} />
          ))}
        </>
      )}
      {a.type === "noul" && (
        <>
          <div className="text-sm">
            Answer <span className="font-semibold">{(a.noul ?? 0) >= 0.5 ? `true${labels ? ` (${labels.true})` : ""}` : `false${labels ? ` (${labels.false})` : ""}`}</span>
          </div>
          <Bar label={`P(true${labels ? ` / ${labels.true}` : ""})`} value={a.noul ?? 0} />
        </>
      )}
      {a.warning && (
        <p className="text-xs text-ink-2">
          <span aria-hidden>⚠ </span>
          {a.warning === "uncalibrated_confidence" ? "More than 10 options: this confidence is not calibrated." : a.warning}
        </p>
      )}
    </div>
  );
}

function Results({ result, draft }: { result: RunResult; draft: Draft }) {
  const body = result.body as {
    answers?: Record<string, Answer>;
    warning?: string;
    routing?: { model?: string; served_by?: string; reason?: string };
    usage?: { input_tokens?: number };
    error?: { message?: string; details?: { field: string; message: string }[] };
  };
  const ok = result.status === 200;
  const json = JSON.stringify(result.body, null, 2);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={result.status === 0 ? "critical" : statusTone(result.status)}>{result.status === 0 ? "Network error" : `HTTP ${result.status}`}</Badge>
        <span className="text-ink-2 tnum">{result.ms} ms round trip</span>
        {body.routing?.served_by && <span className="text-ink-2">· model {body.routing.served_by}</span>}
        {body.usage?.input_tokens !== undefined && <span className="text-ink-2">· {body.usage.input_tokens} tokens</span>}
      </div>
      {body.warning === "language_mismatch" && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-ink-2">
          <span aria-hidden>⚠ </span>The text was routed to “{body.routing?.model}”, which is not loaded, so it ran on “{body.routing?.served_by}”. Treat these answers
          as unreliable.
        </p>
      )}
      {!ok && (
        <div role="alert" className="rounded-md border border-critical/40 bg-critical/5 px-3 py-2 text-sm">
          <div className="font-medium text-critical">{body.error?.message ?? "Request failed"}</div>
          {body.error?.details && body.error.details.length > 1 && (
            <ul className="mt-1 list-disc pl-5 text-ink-2">
              {body.error.details.map((d, i) => (
                <li key={i}>
                  <code className="font-mono text-xs">{d.field}</code>: {d.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {ok &&
        Object.entries(body.answers ?? {}).map(([name, a]) => {
          const q = draft.questions.find((x) => x.name.trim() === name);
          const labels = q && q.labelFalse.trim() && q.labelTrue.trim() ? { false: q.labelFalse.trim(), true: q.labelTrue.trim() } : undefined;
          return <AnswerCard key={name} name={name} a={a} labels={labels} />;
        })}
      <details open={!ok}>
        <summary className="cursor-pointer text-sm text-ink-2">Raw JSON</summary>
        <div className="mt-2 flex justify-end">
          <CopyButton text={json} label="Copy JSON" />
        </div>
        <pre className="mt-2 max-h-[32rem] overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-xs">{json}</pre>
      </details>
    </div>
  );
}

// ------------------------------------------------------------------ page

export function Playground() {
  const [draft, setDraft] = useState<Draft>(() => TEMPLATES[0].draft());
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [lastDraft, setLastDraft] = useState<Draft | null>(null);
  const [pending, start] = useTransition();

  const setQ = (i: number, q: DraftQuestion) => setDraft({ ...draft, questions: draft.questions.map((x, j) => (j === i ? q : x)) });

  function run() {
    const { payload, errors } = toPayload(draft);
    setErrors(errors);
    if (!payload) return;
    start(async () => {
      const r = await runPrediction(payload);
      setResult(r);
      setLastDraft(draft);
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        <Card title="Templates">
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setDraft(t.draft());
                  setErrors([]);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Card>

        <Card title="State" description="The text (or JSON object) the questions are about.">
          <div className="mb-3 flex gap-1" role="radiogroup" aria-label="State format">
            {(["text", "json"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={draft.stateMode === m}
                className={`btn btn-sm ${draft.stateMode === m ? "border-accent text-accent" : ""}`}
                onClick={() =>
                  setDraft({
                    ...draft,
                    stateMode: m,
                    json: m === "json" && !draft.json ? JSON.stringify(draft.stateKey ? { [draft.stateKey]: draft.text } : draft.text, null, 2) : draft.json,
                  })
                }
              >
                {m === "text" ? "Text" : "JSON"}
              </button>
            ))}
          </div>
          {draft.stateMode === "text" ? (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-muted">
                Wrap under key
                <input value={draft.stateKey} onChange={(e) => setDraft({ ...draft, stateKey: e.target.value })} className="input w-32 py-1 font-mono" placeholder="(none)" />
              </label>
              <textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} rows={6} className="input" placeholder="Paste text here…" aria-label="State text" />
            </div>
          ) : (
            <textarea value={draft.json} onChange={(e) => setDraft({ ...draft, json: e.target.value })} rows={8} className="input font-mono text-xs" aria-label="State JSON" />
          )}
        </Card>

        <Card title="Questions">
          <div className="space-y-3">
            {draft.questions.map((q, i) => (
              <QuestionEditor key={q.uid} q={q} onChange={(nq) => setQ(i, nq)} onRemove={() => setDraft({ ...draft, questions: draft.questions.filter((_, j) => j !== i) })} />
            ))}
            <div className="flex flex-wrap gap-2">
              {(Object.keys(TYPE_LABEL) as QType[]).map((t) => (
                <button key={t} type="button" className="btn btn-sm" onClick={() => setDraft({ ...draft, questions: [...draft.questions, blankQuestion(t)] })}>
                  + {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {errors.length > 0 && (
          <ul role="alert" className="list-disc space-y-1 rounded-md border border-critical/40 bg-critical/5 py-2 pl-8 pr-3 text-sm text-ink-2">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <button type="button" className="btn btn-primary w-full" onClick={run} disabled={pending}>
          {pending ? "Running…" : "Run prediction"}
        </button>
      </div>

      <div className="xl:sticky xl:top-8 xl:self-start">
        <Card title="Result">
          {result && lastDraft ? <Results result={result} draft={lastDraft} /> : <p className="text-sm text-muted">Run a prediction to see answers here.</p>}
        </Card>
      </div>
    </div>
  );
}
