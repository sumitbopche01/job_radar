import { getTriageQueue } from "@job-radar/core";
import { db } from "@/lib/db";
import { TriageClient, type TriageItem } from "./triage-client";
import { TopBar } from "./nav";

export const dynamic = "force-dynamic";

export default async function TriagePage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string }>;
}) {
  const { profile } = await searchParams;
  const jobs = await getTriageQueue(db, { limit: 60, sinceDays: 14, profileLabel: profile });

  // Serialize dates for the client component.
  const items: TriageItem[] = jobs.map((j) => ({
    ...j,
    postedAt: j.postedAt ? j.postedAt.toISOString() : null,
    firstSeenAt: j.firstSeenAt.toISOString(),
    rubric: (j.rubric ?? null) as TriageItem["rubric"],
  }));

  return (
    <main className="flex h-dvh flex-col bg-canvas">
      <TopBar active={profile ?? ""} page="triage" count={items.length} />
      <TriageClient items={items} ranked={Boolean(profile)} />
    </main>
  );
}
