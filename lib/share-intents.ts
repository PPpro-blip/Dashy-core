export function shareText(title: string, url: string): string {
  return `Built with DashyCore D-Code ⚡ ${title}\n${url}`;
}

export function buildShareIntents(title: string, url: string) {
  const text = shareText(title, url);
  const encodedText = encodeURIComponent(text);
  const encodedUrl = encodeURIComponent(url);
  return {
    WhatsApp: `https://wa.me/?text=${encodedText}`,
    Facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    X: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodeURIComponent(`Built with DashyCore D-Code ⚡ ${title}`)}`,
    Telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(text)}`,
    LinkedIn: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    Reddit: `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodeURIComponent(title)}`,
    Email: `mailto:?subject=${encodeURIComponent(`Built with DashyCore: ${title}`)}&body=${encodedText}`,
  };
}
