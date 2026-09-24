// Question-builder state and its conversion to the API's question format.

export type QType = "choice" | "score" | "noul";

export type DraftQuestion = {
  uid: string;
  name: string;
  type: QType;
  instructions: string;
  options: { label: string; description: string }[]; // choice
  levels: string[]; // score, lowest first
  noulFalse: string; // optional noul criteria (both or neither)
  noulTrue: string;
  labelFalse: string; // optional noul labels (both or neither)
  labelTrue: string;
};

export type Draft = { stateMode: "text" | "json"; stateKey: string; text: string; json: string; questions: DraftQuestion[] };

export const MAX_CHOICE_OPTIONS = 10;
const BOOLEAN_WORDS = new Set(["true", "false", "yes", "no"]);

let counter = 0;
export const uid = () => `q${Date.now().toString(36)}${(counter++).toString(36)}`;

export function blankQuestion(type: QType = "noul"): DraftQuestion {
  return {
    uid: uid(),
    name: "",
    type,
    instructions: "",
    options: [
      { label: "", description: "" },
      { label: "", description: "" },
    ],
    levels: ["", ""],
    noulFalse: "",
    noulTrue: "",
    labelFalse: "",
    labelTrue: "",
  };
}

/** Non-blocking hints shown in the builder (the backend has the final say). */
export function hints(q: DraftQuestion): string[] {
  const out: string[] = [];
  if (q.type === "choice" && q.options.some((o) => BOOLEAN_WORDS.has(o.label.trim().toLowerCase()))) {
    out.push("Labels like yes/no/true/false can make Laya follow the word instead of the description. Use a yes/no (noul) question or descriptive labels.");
  }
  return out;
}

/** Build the request body, or return a list of problems to fix first. */
export function toPayload(d: Draft): { payload?: { state: unknown; questions: Record<string, unknown> }; errors: string[] } {
  const errors: string[] = [];
  let state: unknown;
  if (d.stateMode === "json") {
    try {
      state = JSON.parse(d.json);
    } catch (e) {
      errors.push(`State is not valid JSON: ${(e as Error).message}`);
    }
  } else {
    if (!d.text.trim()) errors.push("Enter some text to decide about.");
    state = d.stateKey.trim() ? { [d.stateKey.trim()]: d.text } : d.text;
  }

  const questions: Record<string, unknown> = {};
  if (!d.questions.length) errors.push("Add at least one question.");
  for (const q of d.questions) {
    const name = q.name.trim();
    const where = name ? `Question “${name}”` : "A question";
    if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) errors.push(`${where}: the name must use only letters, digits and _.`);
    else if (name in questions) errors.push(`${where}: duplicate name.`);
    if (!q.instructions.trim()) errors.push(`${where}: instructions are required.`);

    const out: Record<string, unknown> = { type: q.type, instructions: q.instructions.trim() };
    if (q.type === "choice") {
      const opts = q.options.filter((o) => o.label.trim());
      if (opts.length < 2) errors.push(`${where}: a choice needs at least 2 options.`);
      if (opts.length > MAX_CHOICE_OPTIONS) errors.push(`${where}: at most ${MAX_CHOICE_OPTIONS} options.`);
      out.criteria = opts.some((o) => o.description.trim())
        ? Object.fromEntries(opts.map((o) => [o.label.trim(), o.description.trim() || null]))
        : opts.map((o) => o.label.trim());
    } else if (q.type === "score") {
      const levels = q.levels.map((l) => l.trim()).filter(Boolean);
      if (levels.length < 2) errors.push(`${where}: a score needs at least 2 levels.`);
      out.criteria = levels;
    } else {
      const [f, t] = [q.noulFalse.trim(), q.noulTrue.trim()];
      if (f || t) {
        if (!f || !t) errors.push(`${where}: describe both “false” and “true”, or leave both empty.`);
        out.criteria = { false: f, true: t };
      }
      const [lf, lt] = [q.labelFalse.trim(), q.labelTrue.trim()];
      if (lf || lt) {
        if (!lf || !lt) errors.push(`${where}: set both labels, or leave both empty.`);
        else if (lf === lt) errors.push(`${where}: the two labels must differ.`);
        out.labels = { false: lf, true: lt };
      }
    }
    if (name) questions[name] = out;
  }
  return errors.length ? { errors } : { payload: { state, questions }, errors };
}
