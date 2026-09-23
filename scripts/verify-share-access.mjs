/*
 * Local integration smoke test for share access, without production secrets.
 * Starts a PostgREST/Auth stub and a Next dev process, then checks public,
 * private, owner, short-link and public-policy-recovery responses over HTTP.
 * Run with: node scripts/verify-share-access.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PUBLIC_ID = "33333333-3333-4333-8333-333333333333";
const PRIVATE_ID = "44444444-4444-4444-8444-444444444444";
const PUBLIC_SLUG = "abcdefgh2345";
const PRIVATE_SLUG = "pqrstuvw2345";
const SERVICE_KEY = "test-service-key";
const created = "2026-09-23T00:00:00.000Z";
const projects = new Map([
  [PUBLIC_SLUG, { id: PUBLIC_ID, title: "Public Example", is_public: true }],
  [PRIVATE_SLUG, { id: PRIVATE_ID, title: "Owner Only Example", is_public: false }],
]);
let publicSelectPolicyInstalled = true;
let serviceReads = 0;
let unsafeServiceReads = 0;

const user = (id) => ({
  id,
  aud: "authenticated",
  role: "authenticated",
  email: "owner@example.test",
  app_metadata: {},
  user_metadata: {},
  created_at: created,
});

const backend = createServer((request, response) => {
  const url = new URL(request.url, "http://mock.invalid");
  const token = request.headers.authorization?.replace(/^Bearer /i, "");
  const identity =
    token === "owner-token" ? OWNER : token === "other-token" ? OTHER : null;
  const isService = token === SERVICE_KEY;
  response.setHeader("Content-Type", "application/json");

  if (url.pathname === "/auth/v1/user") {
    response.statusCode = identity ? 200 : 401;
    response.end(
      JSON.stringify(identity ? user(identity) : { message: "not authenticated" }),
    );
    return;
  }
  if (url.pathname === "/rest/v1/dcode_projects") {
    if (isService) {
      serviceReads++;
      // The test stub refuses unfiltered service-role reads. A regression in
      // either the middleware or the API recovery lane must fail the test.
      if (url.searchParams.get("is_public") !== "eq.true") {
        unsafeServiceReads++;
        response.statusCode = 403;
        response.end(JSON.stringify({ message: "Unfiltered service read" }));
        return;
      }
    }
    const slug = url.searchParams.get("share_slug")?.replace(/^eq\./, "");
    const id = url.searchParams.get("id")?.replace(/^eq\./, "");
    const entry = slug
      ? projects.get(slug)
      : [...projects.values()].find((project) => project.id === id);
    const visible =
      entry &&
      (identity === OWNER ||
        (entry.is_public && (publicSelectPolicyInstalled || isService)));
    const row = visible
      ? {
          id: entry.id,
          user_id: OWNER,
          title: entry.title,
          description: "A project worth sharing.",
          language: "typescript",
          files: [
            {
              id: "file-1",
              name: "main.tsx",
              language: "typescript",
              content: "export const ready = true;",
            },
          ],
          is_public: entry.is_public,
          share_slug: [...projects.entries()].find(([, project]) => project === entry)[0],
          created_at: created,
          updated_at: created,
        }
      : null;
    const objectResponse = request.headers.accept?.includes("vnd.pgrst.object");
    if (!row && objectResponse) {
      response.statusCode = 406;
      response.end(
        JSON.stringify({
          code: "PGRST116",
          details: "The result contains 0 rows",
          message: "JSON object requested, multiple (or no) rows returned",
        }),
      );
      return;
    }
    response.end(JSON.stringify(objectResponse ? row : row ? [row] : []));
    return;
  }
  response.statusCode = 404;
  response.end("{}");
});

function sessionCookie(token) {
  // @supabase/ssr's standard base64url session-cookie representation.
  const session = {
    access_token: token,
    refresh_token: "test-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: user(token === "owner-token" ? OWNER : OTHER),
  };
  return `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function main() {
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const backendPort = backend.address().port;
  const appPort = await freePort();
  const app = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "-H",
      "127.0.0.1",
      "-p",
      String(appPort),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${backendPort}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  const collect = (data) => {
    logs = (logs + data.toString()).slice(-16000);
  };
  app.stdout.on("data", collect);
  app.stderr.on("data", collect);
  const base = `http://127.0.0.1:${appPort}`;
  try {
    const deadline = Date.now() + 110_000;
    while (
      !logs.includes("Ready in") &&
      Date.now() < deadline &&
      app.exitCode === null
    ) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!logs.includes("Ready in"))
      throw new Error(`Next dev did not start:\n${logs}`);

    async function check(
      path,
      { cookie, status, contains, location, search, absent } = {},
    ) {
      const response = await fetch(base + path, {
        redirect: "manual",
        headers: cookie ? { Cookie: cookie } : {},
        signal: AbortSignal.timeout(100_000),
      });
      const body = await response.text();
      assert.equal(
        response.status,
        status,
        `${path}: expected ${status}, got ${response.status}: ${body.slice(0, 300)}`,
      );
      if (contains)
        assert.ok(
          body.includes(contains),
          `${path}: response did not include ${contains}`,
        );
      if (absent)
        assert.ok(!body.includes(absent), `${path}: leaked ${absent}`);
      if (location) {
        const redirected = new URL(response.headers.get("location"), base);
        assert.equal(redirected.pathname, location);
        if (search !== undefined) assert.equal(redirected.search, search);
      }
      console.log(
        `✓ ${response.status} ${path}${cookie ? " (authenticated)" : " (anonymous)"}`,
      );
      return body;
    }

    await check("/login", {
      status: 200,
      contains: "Send Code",
      absent: "Sign Up",
    });
    await check("/d-code", { status: 307, location: "/login" });

    // Public short links are never sent to /login. Query params used for OG
    // previews survive the redirect to the canonical viewer.
    await check(`/s/${PUBLIC_SLUG}?title=Public+Example`, {
      status: 307,
      location: `/d-code/share/${PUBLIC_SLUG}`,
      search: "?title=Public+Example",
    });
    const publicBody = await check(`/d-code/share/${PUBLIC_SLUG}`, {
      status: 200,
      contains: "share-card.png",
    });
    assert.match(publicBody, /property="og:image"/);
    await check(`/api/share/${PUBLIC_SLUG}`, {
      status: 200,
      contains: "Public Example",
    });
    await check(`/s/${PUBLIC_ID}`, {
      status: 307,
      location: `/d-code/share/${PUBLIC_ID}`,
    });

    for (const path of [`/s/${PRIVATE_SLUG}`, `/d-code/share/${PRIVATE_SLUG}`, `/s/${PRIVATE_ID}`]) {
      await check(path, {
        status: 403,
        contains: "This link is private or no longer exists",
        absent: "Owner Only Example",
      });
    }
    await check(`/s/${PRIVATE_SLUG}`, {
      cookie: sessionCookie("other-token"),
      status: 403,
      absent: "Owner Only Example",
    });
    await check(`/api/share/${PRIVATE_SLUG}`, {
      status: 404,
      absent: "Owner Only Example",
    });
    await check(`/s/${PRIVATE_SLUG}`, {
      cookie: sessionCookie("owner-token"),
      status: 307,
      location: `/d-code/share/${PRIVATE_SLUG}`,
    });
    await check(`/d-code/share/${PRIVATE_SLUG}`, {
      cookie: sessionCookie("owner-token"),
      status: 200,
    });
    await check(`/api/share/${PRIVATE_SLUG}`, {
      cookie: sessionCookie("owner-token"),
      status: 200,
      contains: "Owner Only Example",
    });

    // Simulate toggling Public Access. The same link should reflect the
    // current DB value, not a stale cached preview or login redirect.
    projects.get(PRIVATE_SLUG).is_public = true;
    await check(`/s/${PRIVATE_SLUG}`, {
      status: 307,
      location: `/d-code/share/${PRIVATE_SLUG}`,
    });
    projects.get(PRIVATE_SLUG).is_public = false;
    await check(`/s/${PRIVATE_SLUG}`, { status: 403 });

    // If the public SELECT policy is missing, middleware and the API route
    // must both recover ONLY published rows via a filtered service-role read.
    publicSelectPolicyInstalled = false;
    const readsBefore = serviceReads;
    await check(`/s/${PUBLIC_SLUG}`, {
      status: 307,
      location: `/d-code/share/${PUBLIC_SLUG}`,
    });
    await check(`/d-code/share/${PUBLIC_SLUG}`, { status: 200 });
    await check(`/api/share/${PUBLIC_SLUG}`, {
      status: 200,
      contains: "Public Example",
    });
    await check(`/s/${PRIVATE_SLUG}`, { status: 403, absent: "Owner Only Example" });
    await check(`/api/share/${PRIVATE_SLUG}`, {
      status: 404,
      absent: "Owner Only Example",
    });
    assert.ok(serviceReads > readsBefore, "No filtered public recovery reads occurred");
    assert.equal(unsafeServiceReads, 0, "A service-role read lacked is_public=true");
    console.log("Share access checks passed, including public-policy recovery.");
  } catch (error) {
    console.error("Server log tail:\n", logs.slice(-4000));
    throw error;
  } finally {
    try {
      process.kill(-app.pid, "SIGTERM");
    } catch {
      /* already exited */
    }
    await new Promise((resolve) => backend.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
