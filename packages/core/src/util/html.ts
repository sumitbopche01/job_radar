const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  bull: "•",
};

/** Decode HTML entities (named + numeric). Greenhouse double-encodes its content field. */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/**
 * Lightweight HTML -> Markdown-ish plain text. Not a full converter — good enough
 * for storage and stage-0 filtering in P0. Full HTML stays in raw_postings for
 * later re-parsing/enrichment.
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  let s = decodeEntities(html);

  s = s.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  s = s.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  s = s.replace(/<\s*\/\s*(p|div|section|ul|ol|tr|table|h[1-6])\s*>/gi, "\n\n");
  s = s.replace(/<\s*li[^>]*>/gi, "- ");
  s = s.replace(/<\s*\/\s*li\s*>/gi, "\n");
  s = s.replace(/<\s*h[1-6][^>]*>/gi, "\n\n## ");
  s = s.replace(/<[^>]+>/g, ""); // strip remaining tags
  s = decodeEntities(s); // second pass for entities revealed after tag strip

  // collapse whitespace
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}
