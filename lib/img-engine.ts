/**
 * DashyCore v7 — reliable image generation engine (Pollinations free tier).
 *
 * Reliability model:
 *  1. buildAttempts() returns an ORDERED list of Pollinations URLs
 *     (model=flux → no model → turbo, then alternate seeds) so a single
 *     failing endpoint/model never kills a generation.
 *  2. loadImage() preflights each URL with a plain browser Image() and a
 *     timeout. It deliberately does NOT set crossOrigin: the Studio only
 *     displays the image (no canvas), and CORS-checked loads fail on
 *     anonymous/error responses even when the image itself is reachable.
 *  3. generateImage() tries every URL, then retries the same URLs through
 *     the same-origin /api/img-proxy (server-side fetch, no CORS) before
 *     giving up with a descriptive error.
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

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;

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

/**
 * Builds the ordered Pollinations URL attempts.
 *
 * Order:
 *  1. model=flux,     intended seed
 *  2. no model,       intended seed
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

  const plan: Array<{ seed: string; model?: ImgEngineModel }> = [
    { seed: intended, model: "flux" },
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
 * onload → resolves with the URL; onerror/timeout → rejects.
 *
 * No crossOrigin: display-only images must not be CORS-checked — that is
 * the most common reason a reachable Pollinations URL fires onerror.
 */
export function loadImage(url: string, timeoutMs = 90_000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || typeof Image === "undefined") {
      reject(new Error("Browser image loader is unavailable"));
      return;
    }

    const image = new Image();
    let settled = false;

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      image.src = "";
      reject(
        new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the image`)
      );
    }, timeoutMs);

    image.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(url);
    };
    image.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(new Error("Image did not respond (onerror)"));
    };

    image.decoding = "async";
    image.src = url;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Generates an image: tries every direct Pollinations URL until one loads,
 * then retries through the same-origin /api/img-proxy, then throws an error
 * describing every failure. First success wins.
 */
export async function generateImage(
  params: ImgEngineParams,
  options: {
    timeoutMs?: number;
    retryDelayMs?: number;
    useProxyFallback?: boolean;
  } = {}
): Promise<GenerateImageResult> {
  const {
    timeoutMs = 90_000,
    retryDelayMs = 2_500,
    useProxyFallback = true,
  } = options;

  const { attempts } = buildAttempts(params);
  const attempted: string[] = [];
  const errors: string[] = [];
  let lastReason = "no attempt made";

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    attempted.push(attempt.url);
    if (process.env.NODE_ENV !== "production") {
      // Exact URL requested — console inspection for dev.
      console.info(
        `[img-engine] direct attempt ${i + 1}/${attempts.length}: ${attempt.url}`
      );
    }
    try {
      await loadImage(attempt.url, timeoutMs);
      return {
        url: attempt.url,
        sourceUrl: attempt.url,
        seed: attempt.seed,
        model: attempt.model ?? "default",
        viaProxy: false,
        attempted,
      };
    } catch (error) {
      lastReason = errorMessage(error);
      errors.push(`${attempt.url} → ${lastReason}`);
      if (retryDelayMs > 0 && i < attempts.length - 1) {
        await sleep(retryDelayMs);
      }
    }
  }

  if (useProxyFallback) {
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      const proxyUrl = `/api/img-proxy?url=${encodeURIComponent(attempt.url)}`;
      attempted.push(proxyUrl);
      if (process.env.NODE_ENV !== "production") {
        console.info(`[img-engine] proxy attempt ${i + 1}/${attempts.length}: ${proxyUrl}`);
      }
      try {
        await loadImage(proxyUrl, timeoutMs);
        return {
          url: proxyUrl,
          sourceUrl: attempt.url,
          seed: attempt.seed,
          model: attempt.model ?? "default",
          viaProxy: true,
          attempted,
        };
      } catch (error) {
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
