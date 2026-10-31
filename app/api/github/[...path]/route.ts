import { NextRequest, NextResponse } from "next/server";
import { approvedGithubPath, approvedGithubQuery } from "@/lib/dcode/github-proxy";

const GITHUB_API = "https://api.github.com";
const COMMON_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, context: Context) {
  const { path: routeSegments } = await context.params;
  const pathname = request.url.replace(/^[^:]+:\/\/[^/]+/, "").split(/[?#]/, 1)[0];
  const prefix = "/api/github/";
  if (!pathname.startsWith(prefix)) return NextResponse.json({ message: "Not allowed." }, { status: 403, headers: COMMON_HEADERS });
  const rawPath = pathname.slice(prefix.length);
  const operation = approvedGithubPath(request.method, rawPath);
  if (!operation || routeSegments.join("/") !== rawPath.split("/").map((segment) => {
    try { return decodeURIComponent(segment); } catch { return ""; }
  }).join("/")) {
    return NextResponse.json({ message: "This GitHub operation is not allowed." }, { status: 403, headers: COMMON_HEADERS });
  }
  const decodedPath = rawPath.split("/").map((segment) => decodeURIComponent(segment)).join("/");
  const query = approvedGithubQuery(decodedPath, request.nextUrl.searchParams);
  if (!query) return NextResponse.json({ message: "Invalid GitHub query." }, { status: 400, headers: COMMON_HEADERS });

  // Supabase SSR exposes provider_token in the browser-readable auth session
  // cookie. This deployment has no server-only provider-token store, so do not
  // accept tokens from that session. Private repo listing and GitHub writes are
  // deliberately disabled; public repository GETs remain anonymous/read-only.
  if (decodedPath === "user/repos" || request.method !== "GET") {
    return NextResponse.json({
      message: "This GitHub operation is unavailable: the app has no server-only provider-token storage. Public repository imports remain available; private repo listing and GitHub writes are disabled.",
    }, { status: 503, headers: COMMON_HEADERS });
  }

  const upstreamUrl = new URL(`${GITHUB_API}/${operation.path}`);
  for (const [key, value] of Object.entries(query)) upstreamUrl.searchParams.set(key, value);
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    return NextResponse.json({ message: "GitHub API request failed." }, { status: 502, headers: COMMON_HEADERS });
  }
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

export { handle as GET };
