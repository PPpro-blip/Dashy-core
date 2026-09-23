import test from "node:test";
import assert from "node:assert/strict";
import { socialShareUrl } from "../lib/share-links.ts";

const link = "https://dashycore.example/s/abcdefgh2345";
const title = "My app & team";

test("X compose URL includes the complete public link and encoded title", () => {
  const target = new URL(socialShareUrl("x", link, title));
  assert.equal(target.origin, "https://twitter.com");
  assert.equal(target.pathname, "/intent/tweet");
  assert.equal(target.searchParams.get("url"), link);
  assert.equal(
    target.searchParams.get("text"),
    `Explore ${title} on DashyCore`,
  );
});

test("WhatsApp compose URL includes the link in the message", () => {
  const target = new URL(socialShareUrl("whatsapp", link, title));
  assert.equal(target.origin, "https://api.whatsapp.com");
  assert.match(target.searchParams.get("text"), /My app & team/);
  assert.match(
    target.searchParams.get("text"),
    /https:\/\/dashycore.example\/s\/abcdefgh2345/,
  );
});

test("LinkedIn share-offsite URL carries the link", () => {
  const target = new URL(socialShareUrl("linkedin", link, title));
  assert.equal(target.origin, "https://www.linkedin.com");
  assert.equal(target.pathname, "/sharing/share-offsite/");
  assert.equal(target.searchParams.get("url"), link);
});
