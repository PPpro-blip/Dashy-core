import test from "node:test";
import assert from "node:assert/strict";
import { speechTextFromMarkdown, MAX_SPEECH_CHARS } from "../lib/voice-elevenlabs.ts";

test("markdown becomes natural speech (no code, URLs or table pipes)", () => {
  const md = [
    "## Quick answer",
    "",
    "Here's **how** — see [the docs](https://x.dev/a).",
    "",
    "- First, install it",
    "- Then run `npm test`",
    "",
    "```ts",
    "const secret = 1;",
    "```",
    "",
    "| Col A | Col B |",
    "|---|---|",
    "| 1 | 2 |",
    "",
    "Visit https://example.com for more!",
  ].join("\n");
  const out = speechTextFromMarkdown(md);
  assert.equal(
    out,
    "Quick answer. Here's how — see the docs. First, install it. Then run npm test. (code block omitted). Col A, Col B. 1, 2. Visit link for more!"
  );
  assert.ok(!out.includes("secret"));
});

test("snake_case identifiers and decimals survive", () => {
  assert.equal(
    speechTextFromMarkdown("Set user_id to 3.14 and _really_ go."),
    "Set user_id to 3.14 and really go."
  );
});

test("long replies are clamped at a sentence boundary under the proxy limit", () => {
  const out = speechTextFromMarkdown("Sentence one. ".repeat(600));
  assert.ok(out.length <= MAX_SPEECH_CHARS);
  assert.ok(out.endsWith("."));
});
