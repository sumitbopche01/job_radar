import Link from "next/link";
import { getApplications } from "@job-radar/core";
import { db } from "@/lib/db";
import { PipelineClient } from "./pipeline-client";

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
    <main className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold">Job Radar</h1>
          <span className="text-xs text-neutral-500">{items.length} applications</span>
        </div>
        <nav className="flex items-center gap-4 text-xs">
          <Link href="/" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
            ← Triage
          </Link>
          <span className="font-medium">Pipeline</span>
        </nav>
      </header>
      <PipelineClient items={items} />
    </main>
  );
}
