"use client";

import { useTransition } from "react";
import { moveStatusAction, nextActionAction } from "../actions";

type Status = "new" | "shortlist" | "applied" | "screen" | "interview" | "offer" | "rejected";

const COLUMNS: Status[] = ["new", "shortlist", "applied", "screen", "interview", "offer", "rejected"];
const LABELS: Record<Status, string> = {
  new: "New",
  shortlist: "Shortlist",
  applied: "Applied",
  screen: "Screen",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

export interface AppItem {
  id: string;
  jobId: string;
  status: Status;
  title: string;
  companyName: string;
  locationRaw: string | null;
  applyUrl: string;
  appliedAt: string | null;
  nextActionAt: string | null;
  notes: string | null;
  updatedAt: string;
}

export function PipelineClient({ items }: { items: AppItem[] }) {
  const [, startTransition] = useTransition();

  const move = (jobId: string, status: Status) =>
    startTransition(() => {
      void moveStatusAction(jobId, status);
    });

  const setNext = (jobId: string, value: string) =>
    startTransition(() => {
      void nextActionAction(jobId, value || null);
    });

  const byStatus = (s: Status) => items.filter((i) => i.status === s);

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
      {COLUMNS.map((col) => {
        const cards = byStatus(col);
        return (
          <section key={col} className="flex w-72 shrink-0 flex-col">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">
                {LABELS[col]}
              </h2>
              <span className="text-xs text-neutral-400">{cards.length}</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
              {cards.map((c) => {
                const idx = COLUMNS.indexOf(c.status);
                return (
                  <article
                    key={c.id}
                    className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <a
                        href={c.applyUrl}
                        target="_blank"
                        rel="noopener"
                        className="line-clamp-2 text-sm font-medium hover:underline"
                      >
                        {c.title}
                      </a>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-xs text-neutral-500">
                      {c.companyName}
                      {c.locationRaw ? ` · ${c.locationRaw}` : ""}
                    </p>

                    <div className="mt-2 flex items-center gap-1">
                      <button
                        aria-label="Move to previous stage"
                        disabled={idx === 0}
                        onClick={() => move(c.jobId, COLUMNS[idx - 1]!)}
                        className="rounded border border-neutral-200 px-1.5 text-xs disabled:opacity-30 dark:border-neutral-700"
                      >
                        ‹
                      </button>
                      <button
                        aria-label="Move to next stage"
                        disabled={idx === COLUMNS.length - 1}
                        onClick={() => move(c.jobId, COLUMNS[idx + 1]!)}
                        className="rounded border border-neutral-200 px-1.5 text-xs disabled:opacity-30 dark:border-neutral-700"
                      >
                        ›
                      </button>
                      <input
                        type="date"
                        aria-label="Next action date"
                        defaultValue={c.nextActionAt ? c.nextActionAt.slice(0, 10) : ""}
                        onChange={(e) => setNext(c.jobId, e.target.value)}
                        className="ml-auto rounded bg-neutral-100 px-1 py-0.5 text-[11px] text-neutral-600 outline-none dark:bg-neutral-800 dark:text-neutral-300"
                      />
                    </div>
                    {c.nextActionAt && isOverdue(c.nextActionAt) && (
                      <p className="mt-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                        follow up due
                      </p>
                    )}
                  </article>
                );
              })}
              {cards.length === 0 && (
                <div className="rounded-lg border border-dashed border-neutral-200 p-3 text-center text-[11px] text-neutral-400 dark:border-neutral-800">
                  empty
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function isOverdue(iso: string): boolean {
  return new Date(iso).getTime() <= Date.now();
}
