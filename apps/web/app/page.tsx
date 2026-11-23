import { getTriageQueue, outreachLinks, usAccessOf, type Region } from "@job-radar/core";
import { db } from "@/lib/db";
import { TriageClient, type TriageItem } from "./triage-client";
import { TopBar } from "./nav";

export const dynamic = "force-dynamic";

export default async function TriagePage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string; region?: string }>;
}) {
  const { profile, region } = await searchParams;
  const jobs = await getTriageQueue(db, {
    limit: 150,
    sinceDays: 14,
    profileLabel: profile,
    region: region as Region | undefined,
  });

  // Serialize dates and attach deterministic outreach links for the client.
  const items: TriageItem[] = jobs.map((j) => ({
    ...j,
    postedAt: j.postedAt ? j.postedAt.toISOString() : null,
    firstSeenAt: j.firstSeenAt.toISOString(),
    rubric: (j.rubric ?? null) as TriageItem["rubric"],
    contacts: outreachLinks(j.companyName, j.title),
    researchContacts: (j.researchContacts ?? null) as TriageItem["researchContacts"],
    researchSummary: j.researchSummary ?? null,
    usAccess: usAccessOf(j.locationRaw, j.remoteType, j.descriptionMd, j.title),
  }));

  return (
    <main className="flex h-dvh flex-col bg-canvas">
      <TopBar activeProfile={profile ?? ""} activeRegion={region ?? ""} page="triage" count={items.length} />
      <TriageClient
        items={items}
        // US views are ordered by access tier (India OK → contract → US hours),
        // so day dividers would interleave — treat them as ranked like a profile.
        ranked={Boolean(profile) || region === "usa" || region === "usa_all"}
        rankLabel={profile ? "by fit" : "by access"}
      />
    </main>
  );
}
