const LEGAL_SUFFIXES =
  /\b(inc|inc\.|llc|l\.l\.c|ltd|ltd\.|limited|corp|corporation|co|gmbh|plc|sa|s\.a|ag|labs|technologies|technology|software|systems)\b/gi;

/** Company name -> stable key: lowercased, legal suffixes stripped, alnum only. */
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/** Title -> stable key: lowercased, parentheticals & punctuation removed. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, " ") // "(Remote)", "(US)" etc.
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Coarse location bucket for cross-source matching. */
export function locationBucket(locationRaw: string | null, remoteType: string): string {
  if (remoteType === "remote") return "remote";
  if (!locationRaw) return "unknown";
  const first = locationRaw.split(/[,/|]/)[0]?.toLowerCase().trim() ?? "";
  return first.replace(/[^a-z0-9]+/g, "") || "unknown";
}

/** The cross-source dedupe key. */
export function dedupeKey(
  companyName: string,
  title: string,
  locationRaw: string | null,
  remoteType: string,
): string {
  return `${normalizeCompany(companyName)}::${normalizeTitle(title)}::${locationBucket(
    locationRaw,
    remoteType,
  )}`;
}
