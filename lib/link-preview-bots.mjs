/**
 * DashyCore v7 — user-agent patterns for link-preview crawlers.
 *
 * Plain ESM (not TypeScript) on purpose: `next.config.mjs` imports it
 * natively for `htmlLimitedBots`, and app code imports the same file, so the
 * two lists can never drift apart.
 *
 * LINK_PREVIEW_BOT_PATTERN — social / chat link UNFURLERS only. They read a
 *   page's Open Graph tags without running JavaScript. `/s/[slug]` serves
 *   these a 200 preview page (so its `generateMetadata` output is what they
 *   see); everyone else — people AND search engines — keeps the 307 redirect
 *   to the canonical /d-code/share viewer.
 *
 * HTML_LIMITED_BOT_PATTERN — Next.js' default `htmlLimitedBots` list plus the
 *   unfurlers above. Next.js streams metadata into <body> for other clients;
 *   bots on this list get blocking metadata in <head>, where every unfurler
 *   looks for it.
 */

/** Social / chat unfurlers (never search-engine crawlers). */
export const LINK_PREVIEW_BOT_PATTERN = [
  "facebookexternalhit",
  "facebookcatalog",
  "Facebot",
  "meta-externalagent",
  "meta-externalfetcher",
  "Twitterbot",
  "LinkedInBot",
  "Slackbot",
  "Discordbot",
  "WhatsApp",
  "TelegramBot",
  "SkypeUriPreview",
  "vkShare",
  "redditbot",
  "quora link preview",
  "tumblr",
  "bitlybot",
  "Pinterestbot",
  "Mastodon",
  "Cardyb",
  "Embedly",
  "Iframely",
].join("|");

/** Next.js 15.5 default `htmlLimitedBots` (next/dist/shared/lib/router/utils/html-bots). */
const NEXT_DEFAULT_HTML_LIMITED_BOTS =
  "[\\w-]+-Google|Google-[\\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight";

export const HTML_LIMITED_BOT_PATTERN = `${NEXT_DEFAULT_HTML_LIMITED_BOTS}|${LINK_PREVIEW_BOT_PATTERN}`;

/** True when the user agent belongs to a link-preview unfurler. */
export function isLinkPreviewUserAgent(userAgent) {
  return typeof userAgent === "string" && new RegExp(LINK_PREVIEW_BOT_PATTERN, "i").test(userAgent);
}
