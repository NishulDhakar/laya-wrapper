import { Card, ErrorPanel, PageHeader } from "@/components/ui";
import { listKeys } from "@/lib/backend";
import { verifySession } from "@/lib/session";

import { CreateKeyForm, KeysTable } from "./keys-client";

export default async function KeysPage() {
  await verifySession();
  const keys = await listKeys().catch((e: Error) => e);
  const defaultLimit = Number(process.env.DEFAULT_RATE_LIMIT ?? 60);
  return (
    <>
      <PageHeader title="API keys" description="One key per project or client, each with its own rate limit. Callers send it as Authorization: Bearer <key>." />
      <div className="space-y-6">
        <Card title="Create a key">
          <CreateKeyForm defaultLimit={defaultLimit} />
        </Card>
        <Card title="Keys">{keys instanceof Error ? <ErrorPanel message={keys.message} /> : <KeysTable keys={keys} />}</Card>
      </div>
    </>
  );
}
