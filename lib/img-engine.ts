/**
 * DashyCore v7 — reliable image generation engine (Pollinations free tier).
 *
 * Reliability model:
 *  1. buildAttempts() returns an ORDERED list of Pollinations URLs
 *     (chosen model → no model → turbo, then alternate seeds) so a single
 *     failing endpoint/model never kills a generation.
 *  2. loadImage() preflights each URL with a plain browser Image() and a
 *     STRICT per-attempt timeout (15s). It deliberately does NOT set
 *     crossOrigin: the Studio only displays the image (no canvas), and
 *     CORS-checked loads fail on anonymous/error responses even when the
 *     image itself is reachable. The tile is only marked `ready` after
 *     `onload` actually fires.
 *  3. generateImage() tries every direct URL, then retries through the
 *     same-origin /api/img-proxy (server-side fetch, no CORS, 15s strict
 *     server timeout) before giving up with a descriptive error.
 *  4. A HARD overall deadline (45s) plus caller-supplied AbortSignals mean
 *     a hung generation can never spin forever: every wait in this engine
 *     (preflight, retry delay, proxy load) observes the combined signal and
 *     rejects with an AbortError the moment it fires.
 *
 * The legacy "https://pollinations.ai/p/{prompt}" route is intentionally
 * NOT used: it no longer serves images (it redirects to the homepage).
 */

export type ImgEngineModel = "flux" | "turbo" | "default";

export type ImgEngineParams = {
  prompt: string;
  width?: number;
  height?: number;
  seed?: string | number;
  model?: ImgEngineModel;
};

export type ImgUrlAttempt = {
  url: string;
  seed: string;
  model?: ImgEngineModel;
};

export type GenerateImageResult = {
  /**
   * Final URL safe to use directly as <img src>. This is the direct
   * Pollinations URL when it loaded, otherwise the same-origin proxy URL
   * (relative, e.g. `/api/img-proxy?url=…`).
   */
  url: string;
  /** Original Pollinations URL (before any proxying). */
  sourceUrl: string;
  seed: string;
  model: ImgEngineModel;
  viaProxy: boolean;
  /** Every URL that was actually attempted (direct + proxied). */
  attempted: string[];
};

export type GenerateImageOptions = {
  /**
   * Per-attempt preflight timeout (browser Image onload). Default 15s —
   * a model-specific URL that hasn't produced pixels in 15s is a failed
   * attempt, and the engine moves on to the next fallback.
   */
  timeoutMs?: number;
  /**
   * Per-attempt timeout for the same-origin /api/img-proxy fallback.
   * Default 15s (mirrors the route's own strict server-side timeout).
   */
  proxyTimeoutMs?: number;
  /**
   * HARD overall deadline. When exceeded, the combined signal aborts and
   * generateImage() rejects with an AbortError. Default 45s.
   */
  deadlineMs?: number;
  /** Pause between failed attempts. Default 500ms. */
  retryDelayMs?: number;
  /** Retry direct URLs through the same-origin proxy. Default true. */
  useProxyFallback?: boolean;
  /** Caller-owned signal (e.g. a Cancel button). Abort propagates instantly. */
  signal?: AbortSignal;
};

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;

/** Hard overall generation deadline — Studio tiles never spin past this. */
export const GENERATION_DEADLINE_MS = 45_000;
/** Strict per-attempt preflight timeout (direct + proxied URLs). */
export const PER_ATTEMPT_TIMEOUT_MS = 15_000;

/** Aspect map used by Studio + <IMG> Studio (1:1 / 16:9 / 9:16). */
export const ASPECT_SIZES: Record<string, [number, number]> = {
  "1:1": [1024, 1024],
  "16:9": [1280, 720],
  "9:16": [720, 1280],
};

/** Always-unique seed format (spec): `{Date.now()}_{random base36}`. */
export function freshSeed(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Alternate seed: simple numeric range (some Pollinations deployments only accept numeric seeds). */
function alternateSeed(): string {
  return `${Date.now() % 1_000_000_000}${Math.floor(Math.random() * 1_000_000)}`;
}

function resolveSeed(seed?: string | number): string {
  return seed === undefined || seed === "" ? freshSeed() : String(seed);
}

function urlFor(
  prompt: string,
  width: number,
  height: number,
  seed: string,
  model?: ImgEngineModel
): string {
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    nologo: "true",
    seed,
  });
  // "default" means "let Pollinations choose" — omit the param entirely.
  const modelParam = model === "flux" || model === "turbo" ? model : undefined;
  if (modelParam) params.set("model", modelParam);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt
  )}?${params.toString()}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Builds a DOMException carrying the standard AbortError name. */
export function abortError(reason = "The operation was aborted."): DOMException {
  return new DOMException(reason, "AbortError");
}

/** True when an error is an abort/timeout signal — fallback loops must stop, not continue. */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/**
 * Combines several signals into one that aborts when ANY of them aborts.
 * (Manual listener wiring — avoids relying on AbortSignal.any availability.)
 */
function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const defined = signals.filter((s): s is AbortSignal => Boolean(s));
  if (defined.length === 0) return new AbortController().signal;
  if (defined.some((s) => s.aborted)) {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  }
  if (defined.length === 1) return defined[0];

  const controller = new AbortController();
  const forward = () => controller.abort();
  defined.forEach((s) => s.addEventListener("abort", forward, { once: true }));
  controller.signal.addEventListener(
    "abort",
    () => defined.forEach((s) => s.removeEventListener("abort", forward)),
    { once: true }
  );
  return controller.signal;
}

/**
 * Builds the ordered Pollinations URL attempts.
 *
 * Order (mission spec: primary model URL → default no-model endpoint):
 *  1. chosen model,   intended seed        ← primary
 *  2. no model,       intended seed        ← fallback 1 (default endpoint)
 *  3. model=turbo,    intended seed
 *  4. model=flux,     alternate seed (retry path)
 *  5. no model,       alternate seed
 *  6. model=flux,     numeric alternate seed
 *  7. no model,       numeric alternate seed
 *
 * All entries keep the requested width/height/nologo/seed; prompts are
 * trimmed and URL-encoded. Throws on an empty prompt.
 */
export function buildAttempts(params: ImgEngineParams): {
  attempts: ImgUrlAttempt[];
  seed: string;
} {
  const prompt = params.prompt.trim();
  if (!prompt) throw new Error("Image prompt cannot be empty");

  const width = params.width ?? DEFAULT_WIDTH;
  const height = params.height ?? DEFAULT_HEIGHT;
  const intended = resolveSeed(params.seed);
  const altSeed = alternateSeed();
  const numericAltSeed = alternateSeed();

  const chosen: ImgEngineModel = params.model ?? "flux";
  const plan: Array<{ seed: string; model?: ImgEngineModel }> = [
    { seed: intended, model: chosen },
    { seed: intended },
    { seed: intended, model: "turbo" },
    { seed: altSeed, model: "flux" },
    { seed: altSeed },
    { seed: numericAltSeed, model: "flux" },
    { seed: numericAltSeed },
  ];

  const seen = new Set<string>();
  const attempts: ImgUrlAttempt[] = [];
  for (const a of plan) {
    const url = urlFor(prompt, width, height, a.seed, a.model);
    if (!seen.has(url)) {
      seen.add(url);
      attempts.push({ url, seed: a.seed, model: a.model });
    }
  }
  return { attempts, seed: intended };
}

/** Ordered fallback URL list (kept for callers that only need URLs). */
export function buildUrls(params: ImgEngineParams): string[] {
  return buildAttempts(params).attempts.map((a) => a.url);
}

/**
 * Preflights a single image URL with a browser Image().
 * onload → resolves with the URL; onerror/timeout/abort → rejects.
 *
 * No crossOrigin: display-only images must not be CORS-checked — that is
 * the most common reason a reachable Pollinations URL fires onerror.
 * The optional signal aborts the preflight immediately (Cancel button).
 */
export function loadImage(
  url: string,
  timeoutMs: number = PER_ATTEMPT_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || typeof Image === "undefined") {
      reject(new Error("Browser image loader is unavailable"));
      return;
    }
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const image = new Image();
    let settled = false;
    let timer: number | undefined;

    const onAbort = () => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      image.onload = null;
      image.onerror = null;
      image.src = "";
      reject(abortError());
    };

    timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      image.onload = null;
      image.onerror = null;
      image.src = "";
      reject(
        new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the image`)
      );
    }, timeoutMs);

    signal?.addEventListener("abort", onAbort, { once: true });

    image.onload = () => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(url);
    };
    image.onerror = () => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Image did not respond (onerror)"));
    };

    image.decoding = "async";
    image.src = url;
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    let timer: number | undefined;
    const onAbort = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Generates an image: tries every direct Pollinations URL until one loads,
 * then retries through the same-origin /api/img-proxy, then throws an error
 * describing every failure. First success wins.
 *
 * The tile must only be marked complete when the image ACTUALLY loads —
 * every accepted URL (direct or proxied) has passed an Image() onload
 * preflight, and proxied bodies additionally pass server-side image
 * header verification in /api/img-proxy.
 */
export async function generateImage(
  params: ImgEngineParams,
  options: GenerateImageOptions = {}
): Promise<GenerateImageResult> {
  const {
    timeoutMs = PER_ATTEMPT_TIMEOUT_MS,
    proxyTimeoutMs = PER_ATTEMPT_TIMEOUT_MS,
    deadlineMs = GENERATION_DEADLINE_MS,
    retryDelayMs = 500,
    useProxyFallback = true,
  } = options;

  const signal = combineSignals(options.signal, AbortSignal.timeout(deadlineMs));
  const { attempts } = buildAttempts(params);
  const attempted: string[] = [];
  const errors: string[] = [];
  let lastReason = "no attempt made";

  for (let i = 0; i < attempts.length; i++) {
    if (signal.aborted) throw abortError("Generation was aborted.");
    const attempt = attempts[i];
    attempted.push(attempt.url);
    if (process.env.NODE_ENV !== "production") {
      // Exact URL requested — console inspection for dev.
      console.info(
        `[img-engine] direct attempt ${i + 1}/${attempts.length}: ${attempt.url}`
      );
    }
    try {
      await loadImage(attempt.url, timeoutMs, signal);
      return {
        url: attempt.url,
        sourceUrl: attempt.url,
        seed: attempt.seed,
        model: attempt.model ?? "default",
        viaProxy: false,
        attempted,
      };
    } catch (error) {
      if (isAbortError(error) || signal.aborted) throw error;
      lastReason = errorMessage(error);
      errors.push(`${attempt.url} → ${lastReason}`);
      if (retryDelayMs > 0 && i < attempts.length - 1) {
        await sleep(retryDelayMs, signal);
      }
    }
  }

  if (useProxyFallback) {
    for (let i = 0; i < attempts.length; i++) {
      if (signal.aborted) throw abortError("Generation was aborted.");
      const attempt = attempts[i];
      const proxyUrl = `/api/img-proxy?url=${encodeURIComponent(attempt.url)}`;
      attempted.push(proxyUrl);
      if (process.env.NODE_ENV !== "production") {
        console.info(`[img-engine] proxy attempt ${i + 1}/${attempts.length}: ${proxyUrl}`);
      }
      try {
        await loadImage(proxyUrl, proxyTimeoutMs, signal);
        return {
          url: proxyUrl,
          sourceUrl: attempt.url,
          seed: attempt.seed,
          model: attempt.model ?? "default",
          viaProxy: true,
          attempted,
        };
      } catch (error) {
        if (isAbortError(error) || signal.aborted) throw error;
        lastReason = errorMessage(error);
        errors.push(`${proxyUrl} → ${lastReason}`);
      }
    }
  }

  const trimmedDetails = errors.slice(-3).join(" · ");
  throw new Error(
    `All fallbacks failed (${attempted.length} attempts). Last error: ${lastReason}${
      trimmedDetails ? `. Details: ${trimmedDetails}` : ""
    }`
  );
}

/* ----------------------- Backward-compatible exports ----------------------- */

/** Single URL for the chosen model (legacy callers). */
export function buildPollinationsUrl(params: ImgEngineParams): string {
  return buildUrls(params)[0];
}

/** Ordered fallback list (legacy callers). */
export function buildPollinationsFallbacks(params: ImgEngineParams): string[] {
  return buildUrls(params);
}
