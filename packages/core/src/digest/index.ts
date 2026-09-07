import { Resend } from "resend";
import type { Db } from "../db/client.js";
import { stage0Candidates, type Stage0Job } from "../filters/stage0.js";

export interface DigestOptions {
  top?: number;
  sinceDays?: number;
  to?: string;
  from?: string;
  /** force console output even if RESEND_API_KEY is set */
  dryRun?: boolean;
}

export interface DigestResult {
  sent: boolean;
  channel: "resend" | "console";
  count: number;
  subject: string;
  to?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function salaryLabel(j: Stage0Job): string {
  if (j.salaryMin == null && j.salaryMax == null) return "";
  const cur = j.salaryCurrency ?? "";
  const fmt = (n: number) => `${cur}${Math.round(n / 1000)}k`;
  if (j.salaryMin != null && j.salaryMax != null) return ` · ${fmt(j.salaryMin)}–${fmt(j.salaryMax)}`;
  return ` · ${fmt((j.salaryMin ?? j.salaryMax)!)}`;
}

function loc(j: Stage0Job): string {
  if (j.remoteType === "remote") return j.locationRaw ? `Remote · ${j.locationRaw}` : "Remote";
  return j.locationRaw ?? j.remoteType;
}

export function renderDigest(items: Stage0Job[]): { subject: string; html: string; text: string } {
  const date = new Date().toISOString().slice(0, 10);
  const subject = `Job Radar — ${items.length} fresh role${items.length === 1 ? "" : "s"} (${date})`;

  const rowsHtml = items
    .map((j, i) => {
      const posted = (j.postedAt ?? j.firstSeenAt).toISOString().slice(0, 10);
      return `<tr>
        <td style="padding:8px 10px;color:#888;font-variant-numeric:tabular-nums;">${i + 1}</td>
        <td style="padding:8px 10px;">
          <a href="${j.applyUrl}" style="color:#111;font-weight:600;text-decoration:none;">${escapeHtml(j.title)}</a>
          <div style="color:#555;font-size:13px;">${escapeHtml(j.companyName)} · ${escapeHtml(loc(j))}${escapeHtml(salaryLabel(j))}</div>
        </td>
        <td style="padding:8px 10px;color:#888;font-size:12px;white-space:nowrap;">${posted}</td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html><html><body style="margin:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
      <h1 style="font-size:18px;margin:0 0 4px;">Job Radar</h1>
      <p style="color:#666;margin:0 0 16px;font-size:13px;">${items.length} fresh roles past the stage-0 filter · ${date}</p>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #eee;border-radius:8px;">
        ${rowsHtml || `<tr><td style="padding:16px;color:#888;">No new roles today.</td></tr>`}
      </table>
      <p style="color:#aaa;font-size:11px;margin-top:16px;">Ranking is not on yet (P2). This is freshness-ordered.</p>
    </div>
  </body></html>`;

  const text =
    `Job Radar — ${date}\n\n` +
    (items.length
      ? items
          .map((j, i) => `${i + 1}. ${j.title} — ${j.companyName} · ${loc(j)}${salaryLabel(j)}\n   ${j.applyUrl}`)
          .join("\n")
      : "No new roles today.");

  return { subject, html, text };
}

export async function sendDigest(db: Db, opts: DigestOptions = {}): Promise<DigestResult> {
  const items = await stage0Candidates(db, { limit: opts.top ?? 10, sinceDays: opts.sinceDays ?? 7 });
  const { subject, html, text } = renderDigest(items);

  const apiKey = process.env.RESEND_API_KEY;
  const to = opts.to ?? process.env.DIGEST_TO;
  const from = opts.from ?? process.env.DIGEST_FROM ?? "Job Radar <onboarding@resend.dev>";

  if (opts.dryRun || !apiKey || !to) {
    // eslint-disable-next-line no-console
    console.log(`\n[digest dry-run] ${subject}\n${text}\n`);
    return { sent: false, channel: "console", count: items.length, subject };
  }

  const resend = new Resend(apiKey);
  await resend.emails.send({ from, to, subject, html, text });
  return { sent: true, channel: "resend", count: items.length, subject, to };
}
