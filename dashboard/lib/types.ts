export type ApiKey = {
  id: number;
  name: string;
  prefix: string;
  rate_limit_per_min: number;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
};

export type Stats = {
  calls: number;
  errors: number;
  error_rate: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
};

export type Usage = {
  start: string;
  end: string;
  totals: Stats;
  today: Stats;
  per_key: (Stats & { key_id: number | null; source: string; name: string })[];
  per_day: (Stats & { date: string })[];
};

export type LogRow = {
  id: number;
  created_at: string;
  key_id: number | null;
  key_name: string | null;
  source: string;
  endpoint: string;
  status_code: number;
  latency_ms: number;
  model: string | null;
  n_questions: number;
  error: string | null;
  warning: string | null;
  request_body: string | null;
};

export type Health = {
  status: "ok" | "loading";
  model_loaded: boolean;
  models: string[];
  error: string | null;
};
