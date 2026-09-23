import { PageHeader } from "@/components/ui";
import { verifySession } from "@/lib/session";

import { Playground } from "./playground";

export default async function PlaygroundPage() {
  await verifySession();
  return (
    <>
      <PageHeader title="Playground" description="Try questions against the live model. Runs through the admin API, so no API key is needed; calls are logged as “playground”." />
      <Playground />
    </>
  );
}
