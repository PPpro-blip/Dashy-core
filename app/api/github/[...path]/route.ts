import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/server";

/**
 * DashyCore v7 — GitHub API proxy for D-Code Source Control.
 *
 * The ONLY way the Source Control panel talks to GitHub: the Supabase
 * session's GitHub provider_token is attached server-side, so the token
 * never appears in browser JS, project JSON or localStorage.
 *
 * The proxy is deliberately narrow — only paths under `user/` (repo
 * listing) and `repos/` (branches, git data API, trees) are forwarded.
 * The token's own GitHub scopes limit what the user can do.
 */

const GITHUB_API = "https://api.github.com";
const ALLOWED_PREFIXES = ["user/", "repos/"];

async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const apiPath = path.join("/");

  if (!ALLOWED_PREFIXES.some((prefix) => apiPath.startsWith(prefix))) {
    return NextResponse.json(
      { message: "This GitHub proxy path is not allowed." },
      { status: 403 }
    );
  }

  const supabase = await createRouteHandlerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = (session as { provider_token?: string | null } | null)
    ?.provider_token;

  if (!token) {
    return NextResponse.json(
      {
        message:
          "github-not-connected: connect GitHub in the Source Control panel to continue.",
      },
      { status: 401 }
    );
  }

  const url = new URL(`${GITHUB_API}/${apiPath}`);
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${token}`,
  };

  let body: string | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    headers["Content-Type"] = "application/json";
    body = await request.text();
  }

  const upstream = await fetch(url, {
    method: request.method,
    headers,
    body,
    cache: "no-store",
  });

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
