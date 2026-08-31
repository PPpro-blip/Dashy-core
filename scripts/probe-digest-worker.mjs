/**
 * TEMPORARY probe of the LIVE dashy-digest Cloudflare Worker.
 * Throws every plausible userId wire format at it and records status+body.
 */
const WORKER = "https://dashy-digest.kamleshprathampandey.workers.dev";
const UUID = "11111111-1111-1111-1111-111111111111";

function dummyFile() {
  // Node 22: File is global.
  return new File(["hello dashy probe"], "probe.txt", { type: "text/plain" });
}

async function attempt(label, fn) {
  try {
    const res = await fn();
    const text = await res.text();
    let body = text;
    try {
      body = JSON.stringify(JSON.parse(text));
    } catch {
      body = text.slice(0, 200);
    }
    console.log(`${label.padEnd(58)} -> HTTP ${res.status}  ${body}`);
    return { label, status: res.status, body };
  } catch (e) {
    console.log(`${label.padEnd(58)} -> FETCH ERROR: ${e.message}`);
    return { label, status: 0, body: e.message };
  }
}

const results = [];
const post = (url, init) => async () => fetch(url, init);

(async () => {
  console.log(`Probing ${WORKER}\n`);

  // 0. Baselines
  results.push(await attempt("[0a] GET /", async () => fetch(WORKER)));
  results.push(await attempt("[0b] POST empty body", post(WORKER, { method: "POST" })));

  // 1. FormData with `userId` / `user_id` / both
  for (const key of ["userId", "user_id", "userid"]) {
    results.push(
      await attempt(`[1] FormData file+${key}`, async () => {
        const fd = new FormData();
        fd.append("file", dummyFile(), "probe.txt");
        fd.append("filename", "probe.txt");
        fd.append("sourceType", "text");
        fd.append(key, UUID);
        return fetch(WORKER, { method: "POST", body: fd });
      })
    );
  }
  results.push(
    await attempt("[1] FormData file+userId+user_id BOTH", async () => {
      const fd = new FormData();
      fd.append("file", dummyFile(), "probe.txt");
      fd.append("filename", "probe.txt");
      fd.append("sourceType", "text");
      fd.append("userId", UUID);
      fd.append("user_id", UUID);
      return fetch(WORKER, { method: "POST", body: fd });
    })
  );

  // 2. Query string variants
  results.push(
    await attempt("[2] FormData file only + ?userId=", post(`${WORKER}/?userId=${UUID}`, {
      method: "POST",
      body: (() => { const fd = new FormData(); fd.append("file", dummyFile(), "probe.txt"); return fd; })(),
    }))
  );
  results.push(
    await attempt("[2] FormData file only + ?user_id=", post(`${WORKER}/?user_id=${UUID}`, {
      method: "POST",
      body: (() => { const fd = new FormData(); fd.append("file", dummyFile(), "probe.txt"); return fd; })(),
    }))
  );
  results.push(
    await attempt("[2] EMPTY body + ?userId=&user_id=", post(`${WORKER}/?userId=${UUID}&user_id=${UUID}`, { method: "POST" }))
  );

  // 3. Headers
  results.push(
    await attempt("[3] FormData + header x-user-id", post(WORKER, {
      method: "POST",
      headers: { "x-user-id": UUID },
      body: (() => { const fd = new FormData(); fd.append("file", dummyFile(), "probe.txt"); return fd; })(),
    }))
  );
  results.push(
    await attempt("[3] FormData + header X-UserId", post(WORKER, {
      method: "POST",
      headers: { "X-UserId": UUID },
      body: (() => { const fd = new FormData(); fd.append("file", dummyFile(), "probe.txt"); return fd; })(),
    }))
  );

  // 4. JSON bodies
  results.push(
    await attempt("[4] JSON {userId}", post(WORKER, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: UUID }),
    }))
  );
  results.push(
    await attempt("[4] JSON {userId,user_id,text,...}", post(WORKER, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: UUID, user_id: UUID, text: "hello", sourceType: "text", sourceId: "probe", title: "probe" }),
    }))
  );

  // 5. urlencoded
  results.push(
    await attempt("[5] urlencoded userId=", post(WORKER, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ userId: UUID, user_id: UUID }).toString(),
    }))
  );

  // 6. Different paths (in case the live worker routes /upload or /ingest)
  for (const path of ["/upload", "/ingest", "/digest"]) {
    results.push(
      await attempt(`[6] POST ${path} FormData userId`, post(`${WORKER}${path}`, {
        method: "POST",
        body: (() => {
          const fd = new FormData();
          fd.append("file", dummyFile(), "probe.txt");
          fd.append("filename", "probe.txt");
          fd.append("sourceType", "text");
          fd.append("userId", UUID);
          return fd;
        })(),
      }))
    );
  }

  console.log("\n=== SUMMARY (non-`userId is required` responses) ===");
  for (const r of results) {
    if (!/userId is required/i.test(r.body)) {
      console.log(`${r.label.padEnd(58)} -> HTTP ${r.status}  ${r.body.slice(0, 160)}`);
    }
  }
})();
