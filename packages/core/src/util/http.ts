import { request } from "undici";

const UA = "job-radar/0.1 (+personal job discovery; contact sumitbopche01@gmail.com)";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

interface FetchOpts {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
}

/** GET/POST JSON with timeout, exponential backoff, and a typed HttpError on 4xx/5xx. */
export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
  const { method = "GET", body, timeoutMs = 20_000, retries = 2 } = opts;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
    try {
      const res = await request(url, {
        method,
        headers: {
          "user-agent": UA,
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });

      if (res.statusCode >= 400) {
        const text = await res.body.text();
        // 4xx (except 429) won't get better on retry — fail fast.
        const retryable = res.statusCode === 429 || res.statusCode >= 500;
        const err = new HttpError(
          `${method} ${url} -> ${res.statusCode}: ${text.slice(0, 200)}`,
          res.statusCode,
        );
        if (!retryable) throw err;
        lastErr = err;
        continue;
      }
      return (await res.body.json()) as T;
    } catch (err) {
      if (err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        throw err;
      }
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
