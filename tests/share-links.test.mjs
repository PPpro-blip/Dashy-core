import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLinkedInUrl,
  buildShortShareUrl,
  buildWhatsAppUrl,
  buildXUrl,
} from "../lib/share-intents.ts";

const link = "https://dashycore.example/s/abcdefgh2345";
const draft = {
  url: link,
  title: "My app & team",
  caption: "A demo worth sharing",
  tags: ["DashyCore", "D-Code"],
  imageName: null,
  imageDataUrl: null,
};

test("X compose URL keeps the full link, even when the caption is too long", () => {
  for (const caption of [draft.caption, "a".repeat(1000)]) {
    const target = new URL(buildXUrl({ ...draft, caption }));
    assert.equal(target.origin, "https://twitter.com");
    assert.equal(target.pathname, "/intent/tweet");
    assert.equal(target.searchParams.get("url"), link);
    assert.ok(target.searchParams.get("text").length <= 256);
  }
});

test("WhatsApp compose URL includes the project title and link", () => {
  const target = new URL(buildWhatsAppUrl(draft));
  assert.equal(target.origin, "https://wa.me");
  assert.match(target.searchParams.get("text"), /My app & team/);
  assert.match(
    target.searchParams.get("text"),
    /https:\/\/dashycore.example\/s\/abcdefgh2345/,
  );
});

test("LinkedIn share-offsite URL carries the full link", () => {
  const target = new URL(buildLinkedInUrl(draft));
  assert.equal(target.origin, "https://www.linkedin.com");
  assert.equal(target.pathname, "/sharing/share-offsite/");
  assert.equal(target.searchParams.get("url"), link);
});

test("short share URLs preserve the key and encode it as one path segment", () => {
  assert.equal(buildShortShareUrl("https://dashycore.example", "abcdefgh2345"), link);
  assert.equal(
    buildShortShareUrl("https://dashycore.example", "ref #1"),
    "https://dashycore.example/s/ref%20%231",
  );
});
