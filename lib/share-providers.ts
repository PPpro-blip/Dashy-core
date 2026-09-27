/**
 * Share Hub provider contract.
 *
 * This is deliberately capability-first: the UI can explain what a provider
 * can do without pretending that a handoff is a successful publication. The
 * server-side adapters are intentionally not implemented until credentials,
 * OAuth callbacks, media workflows, and persistence are available.
 */
export type ShareProviderId = "x" | "linkedin" | "facebook" | "instagram" | "whatsapp";
export type ShareMode = "direct" | "handoff" | "unavailable";
export type ShareMedia = "text" | "image" | "video" | "url";

export interface ShareProviderCapabilities {
  id: ShareProviderId;
  name: string;
  shortName: string;
  description: string;
  accent: string;
  icon: string;
  mode: ShareMode;
  supportedMedia: ShareMedia[];
  textLimit?: number;
  accountRequirement: string;
  permissions: string;
  warning?: string;
}

export const SHARE_PROVIDERS: ShareProviderCapabilities[] = [
  {
    id: "x",
    name: "X",
    shortName: "X",
    description: "Short-form posts and links",
    accent: "#f4f4f5",
    icon: "𝕏",
    mode: "handoff",
    supportedMedia: ["text", "image", "video", "url"],
    textLimit: 280,
    accountRequirement: "An X account",
    permissions: "User-authorized composer handoff",
    warning: "Direct publishing is not enabled in this workspace yet.",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    shortName: "LinkedIn",
    description: "Professional updates and media",
    accent: "#70b8ff",
    icon: "in",
    mode: "unavailable",
    supportedMedia: ["text", "image", "video", "url"],
    textLimit: 3000,
    accountRequirement: "A connected LinkedIn account",
    permissions: "Organization or member posting permissions",
    warning: "Connect flow and server adapter are not configured yet.",
  },
  {
    id: "facebook",
    name: "Facebook",
    shortName: "Facebook",
    description: "Pages and profile updates",
    accent: "#7aa8ff",
    icon: "f",
    mode: "unavailable",
    supportedMedia: ["text", "image", "video", "url"],
    textLimit: 63206,
    accountRequirement: "A connected Page or profile",
    permissions: "Page publishing permissions",
    warning: "Page selection and server adapter are not configured yet.",
  },
  {
    id: "instagram",
    name: "Instagram",
    shortName: "Instagram",
    description: "Visual posts and captions",
    accent: "#f08ab9",
    icon: "◎",
    mode: "unavailable",
    supportedMedia: ["image", "video"],
    textLimit: 2200,
    accountRequirement: "A connected professional account",
    permissions: "Media publishing permissions",
    warning: "Media upload workflow and server adapter are not configured yet.",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    shortName: "WhatsApp",
    description: "A private share handoff",
    accent: "#65d69a",
    icon: "↗",
    mode: "handoff",
    supportedMedia: ["text", "image", "url"],
    accountRequirement: "WhatsApp on this device",
    permissions: "User-initiated share flow",
    warning: "Dashy will open a share flow; this is not a delivery confirmation.",
  },
];

export function providerById(id: ShareProviderId) {
  return SHARE_PROVIDERS.find((provider) => provider.id === id)!;
}

export function modeLabel(mode: ShareMode) {
  return mode === "direct" ? "Direct publish" : mode === "handoff" ? "Open on platform" : "Not connected";
}
