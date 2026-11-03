import test from "node:test";
import assert from "node:assert/strict";
import { classifyPath, PROTECTED_PREFIXES, PUBLIC_PREFIXES } from "../lib/auth/routes.ts";

test("app sections are protected", () => {
  for (const path of [
    "/chat",
    "/chat/abc-123",
    "/settings",
    "/settings#memory",
    "/projects",
    "/knowledge",
    "/agents",
    "/voice",
    "/studio",
    "/studio/library",
    "/share",
    "/d-code",
    "/d-code/abc",
    "/d-code/analytics",
  ]) {
    const c = classifyPath(path.split("#")[0]);
    assert.equal(c.kind, "protected", `${path} should be protected`);
    assert.ok(c.isProtected);
  }
});

test("public share viewers stay public even under protected prefixes", () => {
  for (const path of ["/d-code/share/abc123", "/d-code/share", "/s/abc123", "/m/xyz"]) {
    const c = classifyPath(path);
    assert.equal(c.kind, "public", `${path} should be public`);
    assert.ok(!c.isProtected);
  }
});

test("login and verify screens are auth pages, not protected", () => {
  for (const path of ["/login", "/login/verify"]) {
    const c = classifyPath(path);
    assert.equal(c.kind, "auth", `${path} should be an auth page`);
    assert.ok(c.isAuthPage);
    assert.ok(!c.isProtected);
  }
});

test("callback, api and root are public (never redirected to /login)", () => {
  for (const path of ["/auth/callback", "/api/voice", "/api/share/abc", "/", "/favicon.ico"]) {
    const c = classifyPath(path);
    assert.equal(c.kind, "public", `${path} should be public`);
  }
});

test("prefix matching never bleeds into sibling paths", () => {
  // "/chatter" must NOT match protected "/chat"
  assert.equal(classifyPath("/chatter").kind, "public");
  assert.equal(classifyPath("/settings2").kind, "public");
  assert.equal(classifyPath("/d-codex").kind, "public");
});

test("route tables are consistent", () => {
  assert.ok(PROTECTED_PREFIXES.includes("/chat"));
  assert.ok(PROTECTED_PREFIXES.includes("/studio"));
  assert.ok(PROTECTED_PREFIXES.includes("/share"));
  assert.ok(PUBLIC_PREFIXES.includes("/d-code/share"));
  assert.ok(PUBLIC_PREFIXES.includes("/s"));
  assert.ok(PUBLIC_PREFIXES.includes("/m"));
});
