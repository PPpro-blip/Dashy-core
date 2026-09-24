/**
 * DashyCore v7 — Meta Graph API client for the Share Hub's "Direct API Pro"
 * mode (Instagram + Facebook).
 *
 * Runs entirely in the browser: the access token lives in THIS browser's
 * localStorage (Settings → Meta Share), is never sent to a DashyCore server
 * or written to the database, and is only ever attached to requests that go
 * straight to graph.facebook.com (which is CORS-enabled).
 *
 * Publish paths:
 *   - Facebook Page feed: `POST /{page-id}/feed` (message + link — the link
 *     preview comes from the share page's Open Graph tags).
 *   - Instagram professional account: `POST /{ig-user-id}/media` creates a
 *     container from a PUBLIC JPEG URL, `GET /{container}?fields=status_code`
 *     waits until it is FINISHED, then `POST /{ig-user-id}/media_publish`.
 *
 * Standard mode (copy caption + Meta's own web share) needs none of this.
 */

/** Graph API version. v25.0 shipped 2026-02-18 and is supported until mid-2028. */
export const META_GRAPH_VERSION = "v25.0";
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export const META_TOKEN_STORAGE_KEY = "dashy.meta.token";
export const META_PAGE_STORAGE_KEY = "dashy.meta.page";
/** Fired on window whenever the token or the selected Page changes. */
export const META_CHANGED_EVENT = "dashy:meta-changed";

/**
 * Permissions a token needs for both publish paths:
 *   - Facebook Page posts: pages_show_list, pages_read_engagement, pages_manage_posts
 *   - Instagram publishing: instagram_basic, instagram_content_publish
 */
export const META_REQUIRED_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
] as const;

/** Instagram caption hard limit. */
export const INSTAGRAM_CAPTION_LIMIT = 2200;

const REQUEST_TIMEOUT_MS = 20_000;
/** Image containers are usually FINISHED immediately; allow a short wait. */
const CONTAINER_POLL_ATTEMPTS = 6;
const CONTAINER_POLL_DELAY_MS = 1500;

/* ---------------------------------------------------------------------- */
/* Types                                                                   */
/* ---------------------------------------------------------------------- */

export interface MetaPage {
  id: string;
  name: string;
  /** Page access token — what publishing requests are signed with. */
  accessToken: string;
  /** Instagram professional account linked to the Page, when there is one. */
  instagramUserId: string | null;
  instagramUsername: string | null;
}

export interface MetaProfile {
  id: string;
  name: string;
  /** "user" when a user token listed its Pages; "page" for a pasted Page token. */
  tokenKind: "user" | "page";
  pages: MetaPage[];
}

export type MetaPublishTarget = "facebook" | "instagram";

export type MetaPublishResult =
  | {
      ok: true;
      target: MetaPublishTarget;
      /** Post id (Facebook) or media id (Instagram). */
      id: string;
      permalink: string | null;
    }
  | { ok: false; target: MetaPublishTarget; error: string };

/* ---------------------------------------------------------------------- */
/* Local persistence (this browser only)                                    */
/* ---------------------------------------------------------------------- */

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function announce(): void {
  if (isBrowser()) window.dispatchEvent(new CustomEvent(META_CHANGED_EVENT));
}

export function readMetaToken(): string {
  if (!isBrowser()) return "";
  try {
    return window.localStorage.getItem(META_TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeMetaToken(token: string | null): void {
  if (!isBrowser()) return;
  try {
    const value = token?.trim();
    if (value) window.localStorage.setItem(META_TOKEN_STORAGE_KEY, value);
    else window.localStorage.removeItem(META_TOKEN_STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode) — nothing persisted.
  }
  announce();
}

export function readSelectedPageId(): string {
  if (!isBrowser()) return "";
  try {
    return window.localStorage.getItem(META_PAGE_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeSelectedPageId(pageId: string | null): void {
  if (!isBrowser()) return;
  try {
    if (pageId) window.localStorage.setItem(META_PAGE_STORAGE_KEY, pageId);
    else window.localStorage.removeItem(META_PAGE_STORAGE_KEY);
  } catch {
    // Ignore — the selection simply is not remembered.
  }
  announce();
}

/* ---------------------------------------------------------------------- */
/* Transport                                                               */
/* ---------------------------------------------------------------------- */

interface GraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
}

/** Error carrying Meta's numeric code so callers can branch on it. */
export class MetaGraphError extends Error {
  readonly status: number;
  readonly code?: number;

  constructor(message: string, status: number, code?: number) {
    super(message);
    this.name = "MetaGraphError";
    this.status = status;
    this.code = code;
  }
}

/** Turns Meta's error envelope into something a person can act on. */
export function describeGraphError(error: GraphErrorBody | undefined, status: number): string {
  const raw = (error?.error_user_msg || error?.message || "").trim();
  if (error?.code === 190 || /access token/i.test(raw)) {
    return `${raw || "Invalid token"} — the token is invalid or expired. Paste a fresh one in Settings → Meta Share.`;
  }
  if (error?.code === 10 || error?.code === 200 || /permission/i.test(raw) || status === 403) {
    return `${raw || "Permission denied"} — the token cannot publish here (missing permission, or you do not manage this Page).`;
  }
  if (error?.code === 4 || error?.code === 17 || error?.code === 32 || status === 429) {
    return `${raw || "Rate limited"} — Meta is rate-limiting this account. Wait a few minutes and retry.`;
  }
  return raw || `Meta Graph API returned HTTP ${status}.`;
}

async function graphRequest<T>(
  path: string,
  options: { method?: "GET" | "POST"; params: Record<string, string> }
): Promise<T> {
  const method = options.method ?? "GET";
  const url = new URL(`${META_GRAPH_BASE}${path}`);
  let body: URLSearchParams | undefined;
  if (method === "GET") {
    for (const [key, value] of Object.entries(options.params)) url.searchParams.set(key, value);
  } else {
    body = new URLSearchParams(options.params);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url.toString(), { method, body, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new MetaGraphError("Meta did not respond in time. Try again.", 0);
    }
    throw new MetaGraphError("Could not reach the Meta Graph API. Check your connection.", 0);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  const graphError = (parsed as { error?: GraphErrorBody } | null)?.error;
  if (!response.ok || graphError) {
    throw new MetaGraphError(
      describeGraphError(graphError, response.status),
      response.status,
      graphError?.code
    );
  }
  return parsed as T;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* ---------------------------------------------------------------------- */
/* Profile / Pages                                                          */
/* ---------------------------------------------------------------------- */

interface GraphInstagramAccount {
  id: string;
  username?: string;
}

interface GraphPage {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: GraphInstagramAccount | null;
}

const PAGE_FIELDS = "id,name,access_token,instagram_business_account{id,username}";

function toMetaPage(page: GraphPage, fallbackToken: string): MetaPage {
  return {
    id: page.id,
    name: page.name ?? page.id,
    accessToken: page.access_token ?? fallbackToken,
    instagramUserId: page.instagram_business_account?.id ?? null,
    instagramUsername: page.instagram_business_account?.username ?? null,
  };
}

/**
 * Resolves a token into the Pages it can publish to (with each Page's linked
 * Instagram account). Accepts either a USER token (lists `/me/accounts`) or a
 * PAGE token pasted directly (then `/me` IS the Page).
 */
export async function fetchMetaProfile(token: string): Promise<MetaProfile> {
  const trimmed = token.trim();
  if (!trimmed) throw new MetaGraphError("Add a Meta Graph access token first.", 0);

  const me = await graphRequest<{ id: string; name?: string }>("/me", {
    params: { fields: "id,name", access_token: trimmed },
  });

  try {
    const accounts = await graphRequest<{ data?: GraphPage[] }>("/me/accounts", {
      params: { fields: PAGE_FIELDS, limit: "100", access_token: trimmed },
    });
    return {
      id: me.id,
      name: me.name ?? me.id,
      tokenKind: "user",
      pages: (accounts.data ?? []).map((page) => toMetaPage(page, trimmed)),
    };
  } catch (error) {
    // A Page token cannot list /me/accounts — there `/me` IS the Page. The
    // Page-only `instagram_business_account` field below only resolves for a
    // Page token, so success here identifies one; otherwise keep the error.
    const page = await graphRequest<GraphPage>("/me", {
      params: { fields: "id,name,instagram_business_account{id,username}", access_token: trimmed },
    }).catch(() => null);
    if (!page?.id) throw error;
    return {
      id: page.id,
      name: page.name ?? me.name ?? page.id,
      tokenKind: "page",
      pages: [toMetaPage({ ...page, access_token: trimmed }, trimmed)],
    };
  }
}

/* ---------------------------------------------------------------------- */
/* Publishing                                                              */
/* ---------------------------------------------------------------------- */

export interface PublishFacebookInput {
  page: MetaPage;
  message: string;
  /** Link attached to the post — Facebook renders its Open Graph preview. */
  link?: string;
}

/** Posts to a Page feed. */
export async function publishToFacebook(input: PublishFacebookInput): Promise<MetaPublishResult> {
  const { page, message, link } = input;
  if (!message.trim() && !link) {
    return { ok: false, target: "facebook", error: "Write a caption (or attach the link) first." };
  }
  try {
    const params: Record<string, string> = { access_token: page.accessToken };
    if (message.trim()) params.message = message.trim();
    if (link) params.link = link;
    const created = await graphRequest<{ id?: string }>(`/${page.id}/feed`, {
      method: "POST",
      params,
    });
    const id = created.id ?? "";
    let permalink: string | null = null;
    if (id) {
      const details = await graphRequest<{ permalink_url?: string }>(`/${id}`, {
        params: { fields: "permalink_url", access_token: page.accessToken },
      }).catch(() => null);
      permalink = details?.permalink_url ?? `https://www.facebook.com/${id}`;
    }
    return { ok: true, target: "facebook", id, permalink };
  } catch (error) {
    return {
      ok: false,
      target: "facebook",
      error: error instanceof Error ? error.message : "Publishing to Facebook failed.",
    };
  }
}

/** True when a URL can be fetched by Meta's servers (not a local address). */
export function isPubliclyReachableUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    return !(
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === "0.0.0.0" ||
      host === "[::1]"
    );
  } catch {
    return false;
  }
}

/** Instagram only accepts JPEG — best-effort check on the file name/URL. */
export function looksLikeJpeg(nameOrUrl: string): boolean {
  return /\.jpe?g(?:$|[?#&])/i.test(nameOrUrl);
}

export interface PublishInstagramInput {
  page: MetaPage;
  caption: string;
  /** Publicly reachable JPEG URL — Meta downloads it server-side. */
  imageUrl: string;
}

/**
 * Publishes a single-image Instagram post: create a container, wait until
 * Meta reports it FINISHED, then publish it.
 */
export async function publishToInstagram(input: PublishInstagramInput): Promise<MetaPublishResult> {
  const { page, caption, imageUrl } = input;
  const igUserId = page.instagramUserId;
  if (!igUserId) {
    return {
      ok: false,
      target: "instagram",
      error:
        "This Page has no Instagram professional account linked. Link one in Meta Business Suite, or use Standard mode.",
    };
  }
  if (!imageUrl.trim()) {
    return {
      ok: false,
      target: "instagram",
      error: "Instagram posts need a public JPEG image URL.",
    };
  }
  if (!isPubliclyReachableUrl(imageUrl)) {
    return {
      ok: false,
      target: "instagram",
      error:
        "Meta cannot download images from a local address. Use a deployed DashyCore URL or any public JPEG link.",
    };
  }

  try {
    const container = await graphRequest<{ id?: string }>(`/${igUserId}/media`, {
      method: "POST",
      params: {
        image_url: imageUrl.trim(),
        caption: caption.slice(0, INSTAGRAM_CAPTION_LIMIT),
        access_token: page.accessToken,
      },
    });
    if (!container.id) {
      return { ok: false, target: "instagram", error: "Meta did not return a media container id." };
    }

    // Wait for the container: IN_PROGRESS → FINISHED (or ERROR / EXPIRED).
    let status = "IN_PROGRESS";
    for (let attempt = 0; attempt < CONTAINER_POLL_ATTEMPTS; attempt += 1) {
      const state = await graphRequest<{ status_code?: string; status?: string }>(
        `/${container.id}`,
        { params: { fields: "status_code,status", access_token: page.accessToken } }
      );
      status = state.status_code ?? "FINISHED";
      if (status === "FINISHED") break;
      if (status === "ERROR" || status === "EXPIRED") {
        return {
          ok: false,
          target: "instagram",
          error: `Instagram could not process the image (${state.status ?? status}). It must be a public JPEG under 8 MB.`,
        };
      }
      await sleep(CONTAINER_POLL_DELAY_MS);
    }
    if (status !== "FINISHED") {
      return {
        ok: false,
        target: "instagram",
        error: "Instagram is still processing the image. Try publishing again in a minute.",
      };
    }

    const published = await graphRequest<{ id?: string }>(`/${igUserId}/media_publish`, {
      method: "POST",
      params: { creation_id: container.id, access_token: page.accessToken },
    });
    const mediaId = published.id ?? container.id;
    const details = await graphRequest<{ permalink?: string }>(`/${mediaId}`, {
      params: { fields: "permalink", access_token: page.accessToken },
    }).catch(() => null);
    return {
      ok: true,
      target: "instagram",
      id: mediaId,
      permalink:
        details?.permalink ??
        (page.instagramUsername ? `https://www.instagram.com/${page.instagramUsername}/` : null),
    };
  } catch (error) {
    return {
      ok: false,
      target: "instagram",
      error: error instanceof Error ? error.message : "Publishing to Instagram failed.",
    };
  }
}
