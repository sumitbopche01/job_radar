import Link from "next/link";
import { getTriageQueue } from "@job-radar/core";
import { db } from "@/lib/db";
import { TriageClient } from "./triage-client";

export const dynamic = "force-dynamic";

export default async function TriagePage() {
  const jobs = await getTriageQueue(db, { limit: 60, sinceDays: 14 });

  // Serialize dates for the client component.
  const items = jobs.map((j) => ({
    ...j,
    postedAt: j.postedAt ? j.postedAt.toISOString() : null,
    firstSeenAt: j.firstSeenAt.toISOString(),
  }));

  return (
    <main className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold">Job Radar</h1>
          <span className="text-xs text-neutral-500">{items.length} in queue</span>
        </div>
        <nav className="flex items-center gap-4 text-xs">
          <span className="font-medium">Triage</span>
          <Link href="/pipeline" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
            Pipeline →
          </Link>
        </nav>
      </header>
      <TriageClient items={items} />
    </main>
  );
}
