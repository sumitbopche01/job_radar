/**
 * Human salary label. Values >= 1000 render as "$120k"; smaller values (hourly
 * rates some ATS report) render raw so we never show "$0k".
 */
export function formatSalary(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (min == null && max == null) return null;
  const cur = currency ?? "";
  const fmt = (n: number) => (n >= 1000 ? `${cur}${Math.round(n / 1000)}k` : `${cur}${n}`);
  if (min != null && max != null && min !== max) return `${fmt(min)}–${fmt(max)}`;
  return fmt((min ?? max)!);
}
