export type ImgEngineParams = {
  prompt: string;
  width?: number;
  height?: number;
  seed?: string | number;
  model?: "flux" | "turbo" | "default";
};

function seedValue(seed?: string | number) {
  return seed === undefined || seed === "" ? `${Date.now()}_${Math.floor(Math.random() * 1e9)}` : String(seed);
}

function urlFor(params: ImgEngineParams, model?: string) {
  const prompt = params.prompt.trim();
  if (!prompt) throw new Error("Image prompt cannot be empty");
  const query = new URLSearchParams({
    width: String(params.width ?? 1024), height: String(params.height ?? 1024),
    nologo: "true", seed: seedValue(params.seed),
  });
  if (model && model !== "default") query.set("model", model);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${query}`;
}

export function buildPollinationsUrl(params: ImgEngineParams): string {
  return urlFor(params, params.model ?? "flux");
}

export function buildPollinationsFallbacks(params: ImgEngineParams): string[] {
  const seed = seedValue(params.seed);
  return ["flux", undefined, "turbo"].map((model) => urlFor({ ...params, seed }, model));
}

export function loadImage(url: string, timeoutMs = 45000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => { image.src = ""; reject(new Error("Image request timed out")); }, timeoutMs);
    image.onload = () => { window.clearTimeout(timer); resolve(image); };
    image.onerror = () => { window.clearTimeout(timer); reject(new Error("Image engine did not respond")); };
    image.src = url;
  });
}
