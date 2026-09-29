/**
 * DashyCore v7 — Share Hub providers.
 *
 * DashyCore has NO social publishing backend: no OAuth, no stored provider
 * tokens, no server-side posting. What genuinely works today is the
 * official public share/compose handoff each platform exposes on the web.
 *
 * Every provider therefore declares its real capability, and the UI states
 * exactly what will happen. Nothing here ever claims a post was published.
 *
 * The shape below is deliberately provider-based so a future
 * `capability: "direct"` (OAuth + API publish) can be added without
 * redesigning the Share Hub.
 */

import type { ComponentType } from "react";
import {
  FacebookIcon,
  InstagramIcon,
  LinkedinIcon,
  WhatsappIcon,
  XSocialIcon,
} from "@/components/icons";

export type ProviderId = "x" | "linkedin" | "facebook" | "whatsapp" | "instagram";

export type ProviderCapability =
  /** Opens the platform's official composer with our text/URL prefilled. */
  | "web-intent"
  /** No prefill endpoint exists — we copy the caption and open the app. */
  | "manual-handoff"
  /** Reserved for a future OAuth + API integration. Not used yet. */
  | "direct";

export interface ProviderPrefill {
  text: boolean;
  url: boolean;
  /** True only if the platform accepts media through the handoff (none do). */
  media: boolean;
}

export interface ShareProvider {
  id: ProviderId;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  accent: string;
  capability: ProviderCapability;
  prefill: ProviderPrefill;
  /** Soft limit used by the composer counter. */
  charLimit?: number;
  /** Requires a URL before the handoff is useful. */
  requiresUrl: boolean;
  /** One-line, honest description of what pressing the button does. */
  handoffLabel: string;
  note: string;
  /** Builds the handoff URL, or null when the platform has no intent API. */
  buildUrl: (payload: { text: string; url: string | null }) => string | null;
}

export const SHARE_PROVIDERS: ShareProvider[] = [
  {
    id: "x",
    label: "X",
    Icon: XSocialIcon,
    accent: "#e7e9ea",
    capability: "web-intent",
    prefill: { text: true, url: true, media: false },
    charLimit: 280,
    requiresUrl: false,
    handoffLabel: "Continue on X",
    note: "Opens the X composer with your caption and link prefilled. You post it.",
    buildUrl: ({ text, url }) => {
      const params = new URLSearchParams();
      if (text) params.set("text", text);
      if (url) params.set("url", url);
      return `https://x.com/intent/post?${params.toString()}`;
    },
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    Icon: LinkedinIcon,
    accent: "#0a66c2",
    capability: "web-intent",
    prefill: { text: false, url: true, media: false },
    charLimit: 3000,
    requiresUrl: true,
    handoffLabel: "Continue on LinkedIn",
    note: "LinkedIn's share endpoint accepts the URL only — your caption is copied to the clipboard so you can paste it.",
    buildUrl: ({ url }) =>
      url
        ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`
        : null,
  },
  {
    id: "facebook",
    label: "Facebook",
    Icon: FacebookIcon,
    accent: "#1877f2",
    capability: "web-intent",
    prefill: { text: false, url: true, media: false },
    charLimit: 5000,
    requiresUrl: true,
    handoffLabel: "Continue on Facebook",
    note: "Facebook's sharer accepts the URL only — captions must be typed in Facebook. Yours is copied for you.",
    buildUrl: ({ url }) =>
      url
        ? `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`
        : null,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    Icon: WhatsappIcon,
    accent: "#25d366",
    capability: "web-intent",
    prefill: { text: true, url: true, media: false },
    requiresUrl: false,
    handoffLabel: "Continue on WhatsApp",
    note: "Opens WhatsApp with the message prefilled. You pick the chat and send.",
    buildUrl: ({ text, url }) => {
      const body = [text, url].filter(Boolean).join("\n\n");
      return `https://wa.me/?text=${encodeURIComponent(body)}`;
    },
  },
  {
    id: "instagram",
    label: "Instagram",
    Icon: InstagramIcon,
    accent: "#e1306c",
    capability: "manual-handoff",
    prefill: { text: false, url: false, media: false },
    charLimit: 2200,
    requiresUrl: false,
    handoffLabel: "Copy caption & open Instagram",
    note: "Instagram has no web composer to hand off to. Your caption is copied and Instagram opens — download the media and upload it there.",
    buildUrl: () => "https://www.instagram.com/",
  },
];

export function getProvider(id: ProviderId): ShareProvider {
  return SHARE_PROVIDERS.find((p) => p.id === id) ?? SHARE_PROVIDERS[0];
}

export type ProviderState =
  /** Everything needed for the handoff is present. */
  | "ready"
  /** Needs a public URL that does not exist yet. */
  | "needs-link"
  /** Works, but the platform will not accept the caption. */
  | "partial"
  /** No composer to hand off to at all. */
  | "manual";

export interface ProviderStatus {
  state: ProviderState;
  label: string;
  detail: string;
}

/**
 * The honest, current state of a provider for the active source.
 *
 * `hasUrl` reflects whether a real public URL exists right now.
 */
export function providerStatus(
  provider: ShareProvider,
  hasUrl: boolean
): ProviderStatus {
  if (provider.requiresUrl && !hasUrl) {
    return {
      state: "needs-link",
      label: "Needs a public link",
      detail: `${provider.label} can only receive a URL. Publish a public link first.`,
    };
  }
  if (provider.capability === "manual-handoff") {
    return {
      state: "manual",
      label: "Manual handoff",
      detail: provider.note,
    };
  }
  if (!provider.prefill.text) {
    return {
      state: "partial",
      label: "Link only",
      detail: provider.note,
    };
  }
  return {
    state: "ready",
    label: "Ready to share",
    detail: provider.note,
  };
}

/**
 * Direct API publishing is not implemented anywhere in this product yet.
 * Kept as an explicit, single source of truth so no UI can imply otherwise.
 */
export const DIRECT_PUBLISHING_AVAILABLE = false;
