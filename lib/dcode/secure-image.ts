const MIME_BY_EXTENSION = new Map<string, string>([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
]);

export function parseSafeRasterDataUrl(content: string): { mime: string; bytes: Buffer } | null {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(content);
  if (!match || match[2].length % 4 !== 0) return null;
  const mime = match[1].toLowerCase();
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.toString("base64") !== match[2]) return null;
  return { mime, bytes };
}

export function sniffRasterMime(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export function safeRasterImage(content: string, fileName: string): { mime: string; bytes: Buffer } | null {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const expectedMime = MIME_BY_EXTENSION.get(ext);
  if (!expectedMime) return null;
  const parsed = parseSafeRasterDataUrl(content);
  if (!parsed || parsed.mime !== expectedMime || sniffRasterMime(parsed.bytes) !== expectedMime) return null;
  return parsed;
}
