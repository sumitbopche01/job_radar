import Link from "next/link";

const PROFILES = [
  { slug: "", label: "Fresh" },
  { slug: "agent-llm-infra", label: "AI / LLM Infra" },
  { slug: "fullstack-ai", label: "Full-stack AI" },
  { slug: "backend-platform", label: "Backend / Platform" },
];

const REGIONS = [
  { slug: "", label: "All regions" },
  { slug: "india", label: "India" },
  { slug: "europe", label: "Europe" },
  { slug: "uae", label: "Dubai / UAE" },
  { slug: "singapore", label: "Singapore" },
  { slug: "remote", label: "Remote" },
];

function href(profile?: string, region?: string): string {
  const p = new URLSearchParams();
  if (profile) p.set("profile", profile);
  if (region) p.set("region", region);
  const q = p.toString();
  return q ? `/?${q}` : "/";
}

function Logo() {
  return (
    <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-white">
      <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" opacity="0.5" />
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" opacity="0.8" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" />
        <path d="M12 12L18 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function TopBar({
  activeProfile,
  activeRegion,
  page,
  count,
}: {
  activeProfile?: string;
  activeRegion?: string;
  page: "triage" | "pipeline";
  count?: number;
}) {
  const prof = activeProfile ?? "";
  const reg = activeRegion ?? "";
  return (
    <>
      <header className="z-20 flex h-14 shrink-0 items-center gap-4 border-b border-line bg-white px-4 shadow-sm">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight text-neutral-900">Job Radar</span>
        </Link>

        {page === "triage" && (
          <nav className="ml-2 hidden items-center gap-1 lg:flex">
            {PROFILES.map((p) => {
              const isActive = prof === p.slug;
              return (
                <Link
                  key={p.slug}
                  href={href(p.slug, reg)}
                  className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    isActive ? "bg-brand-light text-brand-dark" : "text-neutral-600 hover:bg-neutral-100"
                  }`}
                >
                  {p.label}
                </Link>
              );
            })}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-1">
          {typeof count === "number" && (
            <span className="mr-2 hidden text-[13px] tabular-nums text-neutral-500 sm:inline">
              {count} {page === "pipeline" ? "applications" : "jobs"}
            </span>
          )}
          <NavTab href="/" label="Triage" active={page === "triage"} />
          <NavTab href="/pipeline" label="Pipeline" active={page === "pipeline"} />
        </div>
      </header>

      {page === "triage" && (
        <div className="z-10 flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line bg-white/70 px-4 py-2 backdrop-blur">
          <span className="mr-1 shrink-0 text-xs font-medium text-neutral-400">Region</span>
          {REGIONS.map((r) => {
            const isActive = reg === r.slug;
            return (
              <Link
                key={r.slug}
                href={href(prof, r.slug)}
                className={`shrink-0 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                  isActive
                    ? "border-brand bg-brand text-white"
                    : "border-line bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
                }`}
              >
                {r.label}
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function NavTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
        active ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
      }`}
    >
      {label}
    </Link>
  );
}
