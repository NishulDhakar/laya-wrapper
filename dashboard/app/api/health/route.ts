// Liveness for the dashboard container itself (no auth, no backend data).
export function GET() {
  return Response.json({ status: "ok" });
}
