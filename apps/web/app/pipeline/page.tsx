import { getApplications } from "@job-radar/core";
import { db } from "@/lib/db";
import { PipelineClient } from "./pipeline-client";
import { TopBar } from "../nav";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const rows = await getApplications(db);
  const items = rows.map((r) => ({
    ...r,
    appliedAt: r.appliedAt ? r.appliedAt.toISOString() : null,
    nextActionAt: r.nextActionAt ? r.nextActionAt.toISOString() : null,
    updatedAt: r.updatedAt.toISOString(),
  }));

  return (
    <main className="flex h-dvh flex-col bg-canvas">
      <TopBar active={null} page="pipeline" count={items.length} />
      <PipelineClient items={items} />
    </main>
  );
}
