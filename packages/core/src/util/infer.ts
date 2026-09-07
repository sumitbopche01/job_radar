import type { EmploymentType, RemoteType } from "../types.js";

export function inferRemoteType(
  location: string | null | undefined,
  workplaceType?: string | null,
): RemoteType {
  const wp = (workplaceType ?? "").toLowerCase();
  if (wp.includes("remote")) return "remote";
  if (wp.includes("hybrid")) return "hybrid";
  if (wp.includes("onsite") || wp.includes("on-site") || wp.includes("in office")) return "onsite";

  const loc = (location ?? "").toLowerCase();
  if (!loc) return "unknown";
  if (loc.includes("remote")) return "remote";
  if (loc.includes("hybrid")) return "hybrid";
  return "onsite";
}

export function normalizeEmploymentType(raw: string | null | undefined): EmploymentType {
  const s = (raw ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (!s) return "unknown";
  if (s.includes("fulltime") || s === "full") return "full_time";
  if (s.includes("parttime")) return "part_time";
  if (s.includes("contract") || s.includes("contractor")) return "contract";
  if (s.includes("intern")) return "internship";
  if (s.includes("temp")) return "temporary";
  return "other";
}
