"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { appliedAction, rejectAction, shortlistAction } from "./actions";

export interface Rubric {
  fit_score?: number;
  seniority_match?: "under" | "match" | "over";
  evidence?: string[];
  gaps?: string[];
  eligibility_risk?: "none" | "timezone" | "work_auth" | "onsite";
  founder_question_risk?: string;
  hook?: string;
}

export interface TriageItem {
  id: string;
  title: string;
  companyName: string;
  locationRaw: string | null;
  remoteType: string;
  employmentType: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  postedAt: string | null;
  firstSeenAt: string;
  applyUrl: string;
  source: string;
  descriptionMd: string;
  score: number | null;
  rubric: Rubric | null;
}

const REJECT_REASONS: Record<string, string> = {
  "1": "seniority",
  "2": "location/timezone",
  "3": "comp",
  "4": "stack mismatch",
  "5": "domain",
  "6": "company",
  "0": "other",
};

function salaryLabel(j: TriageItem): string | null {
  const { salaryMin: min, salaryMax: max, salaryCurrency } = j;
  if (min == null && max == null) return null;
  const cur = salaryCurrency ?? "";
  const fmt = (n: number) => (n >= 1000 ? `${cur}${Math.round(n / 1000)}k` : `${cur}${n}`);
  if (min != null && max != null && min !== max) return `${fmt(min)}–${fmt(max)}`;
  return fmt((min ?? max)!);
}

function locLabel(j: TriageItem): string {
  if (j.remoteType === "remote") return j.locationRaw ? `Remote · ${j.locationRaw}` : "Remote";
  return j.locationRaw ?? j.remoteType;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const key = d.toDateString();
  if (key === today.toDateString()) return "Today";
  if (key === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function TriageClient({ items }: { items: TriageItem[] }) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (j) =>
        !removed.has(j.id) &&
        (q === "" ||
          j.title.toLowerCase().includes(q) ||
          j.companyName.toLowerCase().includes(q)),
    );
  }, [items, removed, query]);

  const clampedIndex = Math.min(selected, Math.max(0, visible.length - 1));
  const current = visible[clampedIndex];

  useEffect(() => {
    if (current) rowRefs.current.get(current.id)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const act = useCallback(
    (fn: () => Promise<void>, id: string) => {
      setRemoved((prev) => new Set(prev).add(id));
      setRejecting(false);
      startTransition(() => {
        void fn();
      });
    },
    [],
  );

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      // let the search box own the keyboard while focused
      if (searching) {
        if (e.key === "Escape") {
          setSearching(false);
          searchRef.current?.blur();
        }
        return;
      }

      if (rejecting) {
        if (e.key === "Escape") return setRejecting(false);
        if (e.key in REJECT_REASONS && current) {
          const reason = REJECT_REASONS[e.key];
          return act(() => rejectAction(current.id, reason), current.id);
        }
        return;
      }

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setSelected((i) => Math.min(i + 1, visible.length - 1));
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setSelected((i) => Math.max(i - 1, 0));
          break;
        case "s":
          if (current) act(() => shortlistAction(current.id), current.id);
          break;
        case "a":
          if (current) act(() => appliedAction(current.id), current.id);
          break;
        case "x":
          if (current) setRejecting(true);
          break;
        case "o":
          if (current) window.open(current.applyUrl, "_blank", "noopener");
          break;
        case "/":
          e.preventDefault();
          setSearching(true);
          setTimeout(() => searchRef.current?.focus(), 0);
          break;
      }
    },
    [act, current, rejecting, searching, visible.length],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  return (
    <div className="flex min-h-0 flex-1">
      {/* list */}
      <div className="flex w-2/5 min-w-[320px] flex-col border-r border-neutral-200 dark:border-neutral-800">
        <div className="border-b border-neutral-200 p-2 dark:border-neutral-800">
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearching(true)}
            onBlur={() => setSearching(false)}
            placeholder="/ to search title or company"
            className="w-full rounded bg-neutral-100 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-neutral-400 dark:bg-neutral-900"
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {visible.length === 0 && (
            <li className="p-6 text-center text-sm text-neutral-500">
              Queue empty. Run <code className="rounded bg-neutral-200 px-1 dark:bg-neutral-800">jr crawl</code> for more.
            </li>
          )}
          {visible.map((j, i) => {
            const prev = visible[i - 1];
            const day = dayLabel(j.postedAt ?? j.firstSeenAt);
            const prevDay = prev ? dayLabel(prev.postedAt ?? prev.firstSeenAt) : null;
            const showDay = day !== prevDay;
            const isSel = i === clampedIndex;
            return (
              <li
                key={j.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(j.id, el);
                }}
              >
                {showDay && (
                  <div className="sticky top-0 bg-neutral-100 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
                    {day}
                  </div>
                )}
                <button
                  onClick={() => setSelected(i)}
                  className={`flex w-full flex-col items-start gap-0.5 border-l-2 px-3 py-2 text-left ${
                    isSel
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40"
                      : "border-transparent hover:bg-neutral-100 dark:hover:bg-neutral-900"
                  }`}
                >
                  <span className="flex w-full items-center gap-2">
                    {j.score != null && <ScoreBadge score={j.score} />}
                    <span className="line-clamp-1 text-sm font-medium">{j.title}</span>
                  </span>
                  <span className="line-clamp-1 text-xs text-neutral-500">
                    {j.companyName} · {locLabel(j)}
                    {salaryLabel(j) ? ` · ${salaryLabel(j)}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* detail */}
      <div className="flex min-h-0 flex-1 flex-col">
        {current ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-balance">{current.title}</h2>
                  <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                    {current.companyName} · {locLabel(current)}
                    {salaryLabel(current) ? ` · ${salaryLabel(current)}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {current.employmentType !== "unknown" ? `${current.employmentType} · ` : ""}
                    {current.source} · posted{" "}
                    {new Date(current.postedAt ?? current.firstSeenAt).toLocaleDateString()}
                  </p>
                </div>
                <a
                  href={current.applyUrl}
                  target="_blank"
                  rel="noopener"
                  className="shrink-0 rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
                >
                  Open (o)
                </a>
              </div>
              {current.rubric && <RubricPanel rubric={current.rubric} score={current.score} />}
              <div className="mt-4 whitespace-pre-wrap text-pretty text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
                {current.descriptionMd || "No description."}
              </div>
            </div>
            <Footer rejecting={rejecting} />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
            Nothing selected.
          </div>
        )}
      </div>
    </div>
  );
}

function Footer({ rejecting }: { rejecting: boolean }) {
  return (
    <div className="border-t border-neutral-200 px-4 py-2 text-xs text-neutral-500 dark:border-neutral-800">
      {rejecting ? (
        <span className="text-red-600 dark:text-red-400">
          Reject reason: 1 seniority · 2 location/tz · 3 comp · 4 stack · 5 domain · 6 company · 0 other · Esc cancel
        </span>
      ) : (
        <span>
          <Kbd>j</Kbd>/<Kbd>k</Kbd> move · <Kbd>s</Kbd> shortlist · <Kbd>x</Kbd> reject · <Kbd>a</Kbd>{" "}
          applied · <Kbd>o</Kbd> open · <Kbd>/</Kbd> search
        </span>
      )}
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 80
      ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
      : score >= 60
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
        : "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";
  return (
    <span className={`shrink-0 rounded px-1.5 text-[11px] font-semibold tabular-nums ${tone}`}>{score}</span>
  );
}

function RubricPanel({ rubric, score }: { rubric: Rubric; score: number | null }) {
  return (
    <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className="flex items-center gap-2">
        {score != null && <ScoreBadge score={score} />}
        {rubric.seniority_match && (
          <span className="text-xs text-neutral-500">seniority: {rubric.seniority_match}</span>
        )}
        {rubric.eligibility_risk && rubric.eligibility_risk !== "none" && (
          <span className="text-xs font-medium text-red-600 dark:text-red-400">
            risk: {rubric.eligibility_risk}
          </span>
        )}
      </div>
      {rubric.hook && <p className="mt-2 text-pretty font-medium">{rubric.hook}</p>}
      {rubric.evidence && rubric.evidence.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-semibold text-neutral-500">Evidence</p>
          <ul className="ml-4 list-disc text-sm text-neutral-700 dark:text-neutral-300">
            {rubric.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {rubric.gaps && rubric.gaps.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-semibold text-neutral-500">Gaps</p>
          <ul className="ml-4 list-disc text-sm text-neutral-700 dark:text-neutral-300">
            {rubric.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-neutral-300 bg-neutral-100 px-1 font-mono text-[10px] dark:border-neutral-700 dark:bg-neutral-800">
      {children}
    </kbd>
  );
}
