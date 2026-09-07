import { sql } from "drizzle-orm";

/**
 * Positive role-target allowlist (design §7 "seniority floor / title" gate, inverted
 * to an allowlist). Stage-0 is otherwise a denylist that keeps anything not explicitly
 * blocked — which lets ~all non-engineering roles through. This narrows the pool to the
 * role families we actually want:
 *   - AI / ML / LLM Engineer (incl. research/applied scientist, member of technical staff)
 *   - Forward Deployed / Solutions Engineer
 *   - Backend / Platform / Infra Engineer
 *   - General SWE / Full-stack (SDE)
 *
 * A title must match one of these AND still pass the denylist (sales/support/manager/…)
 * and the geo gate. The single place to change "what roles am I looking for".
 */
export const ROLE_TARGET_PATTERNS = [
  "engineer", // software/backend/platform/ai/ml/security/frontend/devops/sre/solutions/forward-deployed…
  "engineering",
  "developer",
  "swe",
  "sde",
  "programmer",
  "architect", // solutions / software architect
  "machine learning",
  "applied scientist",
  "research scientist",
  "member of technical staff",
  "technical staff",
  "full stack",
  "fullstack",
  "full-stack",
  "forward deployed",
];

export function matchesRole(title: string): boolean {
  const t = (title ?? "").toLowerCase();
  return ROLE_TARGET_PATTERNS.some((p) => t.includes(p));
}

/** SQL condition equivalent, keyed to a table alias (default "jobs"; retrieve uses "j"). */
export function roleTargetClause(alias = "jobs") {
  const title = `lower(coalesce(${alias}.title, ''))`;
  return sql.raw("(" + ROLE_TARGET_PATTERNS.map((p) => `${title} like '%${p}%'`).join(" or ") + ")");
}
