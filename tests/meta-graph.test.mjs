import test from "node:test";
import assert from "node:assert/strict";
import {
  describeGraphError,
  fetchMetaProfile,
  isPubliclyReachableUrl,
  looksLikeJpeg,
  META_GRAPH_VERSION,
  publishToFacebook,
  publishToInstagram,
} from "../lib/meta-graph.ts";

/**
 * Replaces global fetch with a tiny Graph API stub. `routes` maps
 * "METHOD /path" to a body object, `[status, body]`, or a function of
 * (params, callIndex) returning either.
 */
function stubGraph(routes) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const params =
      method === "GET"
        ? Object.fromEntries(url.searchParams)
        : Object.fromEntries(new URLSearchParams(String(init.body ?? "")));
    assert.ok(url.pathname.startsWith(`/${META_GRAPH_VERSION}/`), `versioned path: ${url.pathname}`);
    const path = url.pathname.slice(META_GRAPH_VERSION.length + 1);
    calls.push({ method, path, params });
    let result = routes[`${method} ${path}`];
    if (typeof result === "function") result = result(params, calls.length);
    const [status, body] = Array.isArray(result)
      ? result
      : result
        ? [200, result]
        : [400, { error: { message: `unmocked ${method} ${path}`, code: 100 } }];
    return new Response(JSON.stringify(body), { status });
  };
  return calls;
}

const PAGE = {
  id: "p1",
  name: "Neon Studio",
  accessToken: "page-token",
  instagramUserId: "ig1",
  instagramUsername: "neon.studio",
};

test("public-URL and JPEG guards", () => {
  for (const url of ["http://localhost:3000/x.jpg", "http://127.0.0.1/x.jpg", "http://192.168.1.4/x.jpg", "ftp://example.com/x.jpg", "not a url"]) {
    assert.equal(isPubliclyReachableUrl(url), false, url);
  }
  assert.equal(isPubliclyReachableUrl("https://cdn.example.com/photo.jpg"), true);
  assert.equal(looksLikeJpeg("cover.JPG"), true);
  assert.equal(looksLikeJpeg("https://x.dev/d-code/share/abc/og-image?file=cover.jpeg"), true);
  assert.equal(looksLikeJpeg("cover.png"), false);
});

test("Instagram: waits for the container to FINISH, then publishes and reads the permalink", async () => {
  const calls = stubGraph({
    "POST /ig1/media": { id: "c1" },
    "GET /c1": (_params, index) => ({ status_code: index <= 2 ? "IN_PROGRESS" : "FINISHED" }),
    "POST /ig1/media_publish": { id: "m1" },
    "GET /m1": { permalink: "https://www.instagram.com/p/abc123/" },
  });
  const result = await publishToInstagram({
    page: PAGE,
    caption: "x".repeat(2300),
    imageUrl: "https://cdn.example.com/cover.jpg",
  });
  assert.deepEqual(result, {
    ok: true,
    target: "instagram",
    id: "m1",
    permalink: "https://www.instagram.com/p/abc123/",
  });
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    ["POST /ig1/media", "GET /c1", "GET /c1", "POST /ig1/media_publish", "GET /m1"]
  );
  assert.equal(calls[0].params.caption.length, 2200, "caption trimmed to Instagram's limit");
  assert.equal(calls[0].params.access_token, "page-token");
  assert.equal(calls[3].params.creation_id, "c1");
});

test("Instagram: a container ERROR is reported and nothing is published", async () => {
  const calls = stubGraph({
    "POST /ig1/media": { id: "c9" },
    "GET /c9": { status_code: "ERROR", status: "Error: unsupported format" },
  });
  const result = await publishToInstagram({ page: PAGE, caption: "hi", imageUrl: "https://cdn.example.com/a.png" });
  assert.equal(result.ok, false);
  assert.match(result.error, /unsupported format/);
  assert.ok(!calls.some((c) => c.path.endsWith("/media_publish")));
});

test("Instagram: local image URLs and Pages without Instagram are refused before any request", async () => {
  const calls = stubGraph({});
  const local = await publishToInstagram({ page: PAGE, caption: "hi", imageUrl: "http://localhost:3000/a.jpg" });
  assert.equal(local.ok, false);
  assert.match(local.error, /local address/);
  const noIg = await publishToInstagram({
    page: { ...PAGE, instagramUserId: null, instagramUsername: null },
    caption: "hi",
    imageUrl: "https://cdn.example.com/a.jpg",
  });
  assert.equal(noIg.ok, false);
  assert.equal(calls.length, 0);
});

test("Facebook: posts message + link to the Page feed and returns the permalink", async () => {
  const calls = stubGraph({
    "POST /p1/feed": { id: "p1_123" },
    "GET /p1_123": { permalink_url: "https://www.facebook.com/neonstudio/posts/123" },
  });
  const result = await publishToFacebook({
    page: PAGE,
    message: "Built with DashyCore",
    link: "https://dashy.example/s/abcdefgh2345?title=Neon",
  });
  assert.equal(result.ok, true);
  assert.equal(result.permalink, "https://www.facebook.com/neonstudio/posts/123");
  assert.deepEqual(calls[0].params, {
    access_token: "page-token",
    message: "Built with DashyCore",
    link: "https://dashy.example/s/abcdefgh2345?title=Neon",
  });
});

test("Facebook: Graph errors come back as actionable messages", async () => {
  stubGraph({
    "POST /p1/feed": [400, { error: { message: "Error validating access token", code: 190 } }],
  });
  const result = await publishToFacebook({ page: PAGE, message: "hi" });
  assert.equal(result.ok, false);
  assert.match(result.error, /Settings → Meta Share/);
  assert.match(describeGraphError({ message: "(#200) Permissions error", code: 200 }, 403), /cannot publish here/);
});

test("fetchMetaProfile: user token lists Pages with their Instagram accounts", async () => {
  stubGraph({
    "GET /me": { id: "u1", name: "Demo Owner" },
    "GET /me/accounts": {
      data: [
        { id: "p1", name: "Neon Studio", access_token: "pt1", instagram_business_account: { id: "ig1", username: "neon.studio" } },
        { id: "p2", name: "Side Project", access_token: "pt2" },
      ],
    },
  });
  const profile = await fetchMetaProfile("  user-token  ");
  assert.equal(profile.tokenKind, "user");
  assert.deepEqual(
    profile.pages.map((p) => [p.id, p.accessToken, p.instagramUsername]),
    [["p1", "pt1", "neon.studio"], ["p2", "pt2", null]]
  );
});

test("fetchMetaProfile: a pasted Page token resolves to that single Page", async () => {
  stubGraph({
    "GET /me": (params) =>
      params.fields === "id,name"
        ? { id: "p1", name: "Neon Studio" }
        : { id: "p1", name: "Neon Studio", instagram_business_account: { id: "ig1", username: "neon.studio" } },
    "GET /me/accounts": [400, { error: { message: "(#100) Tried accessing nonexisting field (accounts)", code: 100 } }],
  });
  const profile = await fetchMetaProfile("page-token");
  assert.equal(profile.tokenKind, "page");
  assert.equal(profile.pages.length, 1);
  assert.equal(profile.pages[0].accessToken, "page-token");
  assert.equal(profile.pages[0].instagramUserId, "ig1");
});
