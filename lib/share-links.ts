/** Platform compose URLs. Keep the Dashy link encoded as one URL parameter. */
export type ShareDestination = "x" | "whatsapp" | "linkedin";

export function socialShareUrl(
  destination: ShareDestination,
  url: string,
  title: string,
): string {
  const text = `Explore ${title} on DashyCore`;
  switch (destination) {
    case "x":
      return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    case "whatsapp":
      return `https://api.whatsapp.com/send?text=${encodeURIComponent(`${text} — ${url}`)}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
  }
}
