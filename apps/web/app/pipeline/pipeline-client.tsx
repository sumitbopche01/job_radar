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
// accent dot per stage (single hue family, escalating)
const DOT: Record<Status, string> = {
  new: "bg-neutral-400",
  shortlist: "bg-sky-500",
  applied: "bg-blue-500",
  screen: "bg-indigo-500",
  interview: "bg-amber-500",
  offer: "bg-emerald-500",
  rejected: "bg-rose-400",
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

const AVATAR_COLORS = [
  "bg-sky-100 text-sky-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
  "bg-orange-100 text-orange-700",
  "bg-cyan-100 text-cyan-700",
  "bg-blue-100 text-blue-700",
];
function avatarClass(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

export function PipelineClient({ items }: { items: AppItem[] }) {
  const [, startTransition] = useTransition();

  const move = (jobId: string, status: Status) =>
    startTransition(() => void moveStatusAction(jobId, status));
  const setNext = (jobId: string, value: string) =>
    startTransition(() => void nextActionAction(jobId, value || null));

  const byStatus = (s: Status) => items.filter((i) => i.status === s);

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
      {COLUMNS.map((col) => {
        const cards = byStatus(col);
        return (
          <section key={col} className="flex w-72 shrink-0 flex-col rounded-xl bg-white/50">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <span className={`size-2 rounded-full ${DOT[col]}`} />
              <h2 className="text-sm font-semibold text-neutral-800">{LABELS[col]}</h2>
              <span className="ml-auto rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium tabular-nums text-neutral-500">
                {cards.length}
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {cards.map((c) => {
                const idx = COLUMNS.indexOf(c.status);
                const overdue = c.nextActionAt != null && new Date(c.nextActionAt).getTime() <= Date.now();
                return (
                  <article
                    key={c.id}
                    className="rounded-lg border border-line bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${avatarClass(
                          c.companyName,
                        )}`}
                      >
                        {c.companyName.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "?"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <a
                          href={c.applyUrl}
                          target="_blank"
                          rel="noopener"
                          className="line-clamp-2 text-[13px] font-semibold leading-snug text-neutral-900 hover:text-brand"
                        >
                          {c.title}
                        </a>
                        <p className="mt-0.5 line-clamp-1 text-xs text-neutral-500">
                          {c.companyName}
                          {c.locationRaw ? ` · ${c.locationRaw}` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2.5 flex items-center gap-1">
                      <button
                        aria-label="Move to previous stage"
                        disabled={idx === 0}
                        onClick={() => move(c.jobId, COLUMNS[idx - 1]!)}
                        className="flex size-6 items-center justify-center rounded-md border border-line text-neutral-500 transition-colors hover:bg-neutral-50 disabled:opacity-30"
                      >
                        ‹
                      </button>
                      <button
                        aria-label="Move to next stage"
                        disabled={idx === COLUMNS.length - 1}
                        onClick={() => move(c.jobId, COLUMNS[idx + 1]!)}
                        className="flex size-6 items-center justify-center rounded-md border border-line text-neutral-500 transition-colors hover:bg-neutral-50 disabled:opacity-30"
                      >
                        ›
                      </button>
                      <input
                        type="date"
                        aria-label="Next action date"
                        defaultValue={c.nextActionAt ? c.nextActionAt.slice(0, 10) : ""}
                        onChange={(e) => setNext(c.jobId, e.target.value)}
                        className={`ml-auto rounded-md border px-1.5 py-1 text-[11px] outline-none transition-colors ${
                          overdue
                            ? "border-amber-300 bg-amber-50 text-amber-700"
                            : "border-line bg-neutral-50 text-neutral-500"
                        }`}
                      />
                    </div>
                    {overdue && (
                      <p className="mt-1.5 text-[11px] font-semibold text-amber-600">● follow-up due</p>
                    )}
                  </article>
                );
              })}
              {cards.length === 0 && (
                <div className="rounded-lg border border-dashed border-line py-6 text-center text-[11px] text-neutral-400">
                  Empty
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
