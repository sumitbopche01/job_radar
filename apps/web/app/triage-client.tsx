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

// ---------- helpers ----------
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

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d >= 1) return `${d}d ago`;
  const h = Math.floor(diff / 3600000);
  if (h >= 1) return `${h}h ago`;
  return "Just now";
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

// ---------- component ----------
export function TriageClient({ items, ranked }: { items: TriageItem[]; ranked?: boolean }) {
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

  const act = useCallback((fn: () => Promise<void>, id: string) => {
    setRemoved((prev) => new Set(prev).add(id));
    setRejecting(false);
    startTransition(() => {
      void fn();
    });
  }, []);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
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
          return act(() => rejectAction(current.id, REJECT_REASONS[e.key]), current.id);
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
      {/* ---------- list ---------- */}
      <div className="flex w-2/5 min-w-[340px] max-w-[460px] flex-col border-r border-line bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
          <div className="relative flex-1">
            <SearchIcon />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSearching(true)}
              onBlur={() => setSearching(false)}
              placeholder="Search title or company"
              className="w-full rounded-full border border-line bg-neutral-50 py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-neutral-500">
            {ranked ? "by fit" : "newest"}
          </span>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto">
          {visible.length === 0 && <EmptyState hasItems={items.length > 0} />}
          {visible.map((j, i) => {
            const prev = visible[i - 1];
            const day = dayLabel(j.postedAt ?? j.firstSeenAt);
            const showDay = !ranked && day !== (prev ? dayLabel(prev.postedAt ?? prev.firstSeenAt) : null);
            const isSel = i === clampedIndex;
            const sal = salaryLabel(j);
            return (
              <li
                key={j.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(j.id, el);
                }}
              >
                {showDay && (
                  <div className="sticky top-0 z-10 bg-neutral-50/95 px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 backdrop-blur">
                    {day}
                  </div>
                )}
                <button
                  onClick={() => setSelected(i)}
                  className={`flex w-full gap-3 border-b border-line/70 border-l-2 px-3 py-3 text-left transition-colors ${
                    isSel
                      ? "border-l-brand bg-brand-light/60"
                      : "border-l-transparent hover:bg-neutral-50"
                  }`}
                >
                  <Avatar name={j.companyName} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={`line-clamp-2 text-[15px] font-semibold leading-snug ${
                          isSel ? "text-brand-dark" : "text-neutral-900"
                        }`}
                      >
                        {j.title}
                      </span>
                      {j.score != null && <ScoreBadge score={j.score} />}
                    </div>
                    <div className="mt-0.5 line-clamp-1 text-[13px] text-neutral-700">{j.companyName}</div>
                    <div className="mt-0.5 line-clamp-1 text-xs text-neutral-500">
                      {locLabel(j)}
                      {sal ? ` · ${sal}` : ""}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Tag tone={j.remoteType === "remote" ? "green" : "plain"}>
                        {j.remoteType === "remote" ? "Remote" : j.remoteType}
                      </Tag>
                      <Tag tone="plain">{j.source}</Tag>
                      <span className="text-[11px] text-neutral-400">{relTime(j.postedAt ?? j.firstSeenAt)}</span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ---------- detail ---------- */}
      <div className="flex min-h-0 flex-1 flex-col">
        {current ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
                {/* header card */}
                <div className="rounded-xl border border-line bg-white p-5 shadow-sm sm:p-6">
                  <div className="flex items-start gap-4">
                    <Avatar name={current.companyName} size="lg" />
                    <div className="min-w-0 flex-1">
                      <h2 className="text-xl font-semibold leading-tight text-balance text-neutral-900">
                        {current.title}
                      </h2>
                      <p className="mt-1 text-[15px] font-medium text-neutral-700">{current.companyName}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Tag tone="plain">📍 {locLabel(current)}</Tag>
                        {salaryLabel(current) && <Tag tone="green">{salaryLabel(current)}</Tag>}
                        {current.employmentType !== "unknown" && (
                          <Tag tone="plain">{current.employmentType.replace("_", " ")}</Tag>
                        )}
                        <Tag tone="plain">{current.source}</Tag>
                        <span className="text-xs text-neutral-400">
                          posted {relTime(current.postedAt ?? current.firstSeenAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <a
                      href={current.applyUrl}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-1.5 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
                    >
                      Open posting
                      <span className="text-xs opacity-70">(o)</span>
                    </a>
                    <button
                      onClick={() => act(() => shortlistAction(current.id), current.id)}
                      className="rounded-full border border-brand px-4 py-2 text-sm font-semibold text-brand transition-colors hover:bg-brand-light"
                    >
                      Shortlist (s)
                    </button>
                  </div>
                </div>

                {current.rubric && <MatchCard rubric={current.rubric} score={current.score} />}

                {/* description */}
                <div className="rounded-xl border border-line bg-white p-5 shadow-sm sm:p-6">
                  <h3 className="mb-3 text-sm font-semibold text-neutral-900">About the role</h3>
                  <div className="whitespace-pre-wrap text-pretty text-[14px] leading-relaxed text-neutral-700">
                    {current.descriptionMd || "No description available for this source."}
                  </div>
                </div>
              </div>
            </div>
            <Footer rejecting={rejecting} />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">
            Select a job to see details.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- pieces ----------
function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const initials = name.replace(/[^a-zA-Z0-9 ]/g, "").trim().slice(0, 2).toUpperCase() || "?";
  const dim = size === "lg" ? "size-12 text-base rounded-xl" : "size-10 text-sm rounded-lg";
  return (
    <span className={`flex shrink-0 items-center justify-center font-semibold ${dim} ${avatarClass(name)}`}>
      {initials}
    </span>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone: "plain" | "green" }) {
  const cls =
    tone === "green"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/10"
      : "bg-neutral-100 text-neutral-600 ring-neutral-500/10";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ring-1 ${cls}`}>
      {children}
    </span>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 80
      ? "bg-emerald-100 text-emerald-800"
      : score >= 60
        ? "bg-amber-100 text-amber-800"
        : "bg-neutral-100 text-neutral-500";
  return (
    <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${tone}`}>
      {score}
    </span>
  );
}

function MatchCard({ rubric, score }: { rubric: Rubric; score: number | null }) {
  return (
    <div className="rounded-xl border border-line bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-3">
        {score != null && <ScoreBadge score={score} />}
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">Match analysis</h3>
          <p className="text-xs text-neutral-500">
            {rubric.seniority_match ? `seniority ${rubric.seniority_match}` : "AI-scored fit"}
            {rubric.eligibility_risk && rubric.eligibility_risk !== "none" && (
              <span className="ml-1 font-medium text-rose-600">· risk: {rubric.eligibility_risk}</span>
            )}
          </p>
        </div>
      </div>

      {rubric.hook && (
        <p className="mt-3 rounded-lg bg-brand-light px-3 py-2 text-sm text-brand-dark">{rubric.hook}</p>
      )}

      {rubric.evidence && rubric.evidence.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Why it fits</p>
          <ul className="mt-1 space-y-1">
            {rubric.evidence.map((e, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-neutral-700">
                <span className="mt-0.5 text-emerald-600">✓</span>
                <span className="text-pretty">{e}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rubric.gaps && rubric.gaps.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Gaps</p>
          <ul className="mt-1 space-y-1">
            {rubric.gaps.map((g, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-neutral-700">
                <span className="mt-0.5 text-amber-500">•</span>
                <span className="text-pretty">{g}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Footer({ rejecting }: { rejecting: boolean }) {
  return (
    <div className="shrink-0 border-t border-line bg-white px-4 py-2.5 text-xs text-neutral-500">
      {rejecting ? (
        <span className="font-medium text-rose-600">
          Reject reason — <Kbd>1</Kbd> seniority · <Kbd>2</Kbd> location/tz · <Kbd>3</Kbd> comp ·{" "}
          <Kbd>4</Kbd> stack · <Kbd>5</Kbd> domain · <Kbd>6</Kbd> company · <Kbd>0</Kbd> other ·{" "}
          <Kbd>Esc</Kbd> cancel
        </span>
      ) : (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            <Kbd>j</Kbd> <Kbd>k</Kbd> move
          </span>
          <span>
            <Kbd>s</Kbd> shortlist
          </span>
          <span>
            <Kbd>x</Kbd> reject
          </span>
          <span>
            <Kbd>a</Kbd> applied
          </span>
          <span>
            <Kbd>o</Kbd> open
          </span>
          <span>
            <Kbd>/</Kbd> search
          </span>
        </span>
      )}
    </div>
  );
}

function EmptyState({ hasItems }: { hasItems: boolean }) {
  return (
    <li className="flex flex-col items-center gap-2 p-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
        ✓
      </span>
      <p className="text-sm font-medium text-neutral-700">
        {hasItems ? "No matches for this search" : "You're all caught up"}
      </p>
      <p className="max-w-xs text-xs text-neutral-500">
        {hasItems
          ? "Clear the search to see the rest of the queue."
          : "Run a crawl to pull fresh openings into the queue."}
      </p>
    </li>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-neutral-600 shadow-sm">
      {children}
    </kbd>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14 14L17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
