const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Normalize = require("../lib/normalize");

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

test("clampPercent preserves zero, converts strings, and clamps bounds", () => {
  assert.equal(Normalize.clampPercent(0), 0);
  assert.equal(Normalize.clampPercent(50), 50);
  assert.equal(Normalize.clampPercent(100), 100);
  assert.equal(Normalize.clampPercent(-1), 0);
  assert.equal(Normalize.clampPercent(101), 100);
  assert.equal(Normalize.clampPercent("28"), 28);
  assert.equal(Normalize.clampPercent(null), null);
  assert.equal(Normalize.clampPercent("nope"), null);
});

test("parses object and array payloads and requires exact provider", () => {
  const object = JSON.stringify({ provider: "codex", usage: { primary: { usedPercent: 12 } } });
  assert.equal(Normalize.parseProviderJson(object, "codex").record.summaryUsedPercent, 12);
  assert.equal(Normalize.parseProviderJson(`[${object}]`, "codex").record.summaryUsedPercent, 12);
  assert.equal(Normalize.parseProviderJson("[]", "codex").error, "Provider data not returned");
  assert.equal(Normalize.parseProviderJson(object, "antigravity").error, "Provider data not returned");
});

test("reports malformed JSON without leaking parser details", () => {
  assert.deepEqual(Normalize.parseProviderJson(fixture("malformed.json"), "codex"), {
    ok: false,
    error: "Invalid CodexBar JSON",
    record: null
  });
});

test("normalizes captured Codex and Antigravity fixtures", () => {
  const codex = Normalize.parseProviderJson(fixture("codex-success.json"), "codex");
  assert.equal(codex.ok, true);
  assert.equal(codex.record.source, "oauth");
  assert.equal(codex.record.identity.providerID, "codex");
  assert.equal(codex.record.account, "user@example.invalid");
  assert.equal(codex.record.plan, "plus");
  assert.equal(codex.record.windows.length, 1);
  assert.equal(codex.record.windows[0].label, "Weekly");
  assert.equal(codex.record.summaryUsedPercent, 4);

  const agy = Normalize.parseProviderJson(fixture("antigravity-cli-success.json"), "antigravity");
  assert.equal(agy.ok, true);
  assert.equal(agy.record.source, "cli");
  assert.equal(agy.record.windows.length, 2);
  assert.equal(agy.record.summaryUsedPercent, 0);
});

test("reads nested named windows, removes duplicates, and selects worst known usage", () => {
  const result = Normalize.parseProviderJson(fixture("antigravity-nested-full.synthetic.json"), "antigravity");
  assert.equal(result.ok, true);
  assert.equal(result.record.windows.length, 4);
  assert.deepEqual(result.record.windows.map((window) => window.label), [
    "Gemini Session",
    "Gemini Weekly",
    "Claude + GPT Session",
    "Claude + GPT Weekly",
  ]);
  assert.equal(result.record.summaryUsedPercent, 100);
});

test("usageKnown false stays visible but is excluded, and placeholders are removed", () => {
  const result = Normalize.parseProviderJson(fixture("antigravity-unknown-window.synthetic.json"), "antigravity");
  assert.equal(result.ok, true);
  assert.equal(result.record.windows.length, 1);
  assert.equal(result.record.windows[0].usageKnown, false);
  assert.equal(result.record.windows[0].usedPercent, 100);
  assert.equal(result.record.summaryUsedPercent, null);
});

test("signed-in OAuth payload without windows is a clear failure", () => {
  const result = Normalize.parseProviderJson(fixture("antigravity-oauth-no-limits.synthetic.json"), "antigravity");
  assert.equal(result.ok, false);
  assert.equal(result.error, "Signed in; limits unavailable");
});

test("provider errors are isolated in a multi-provider payload", () => {
  const payload = fixture("partial-error.synthetic.json");
  const codex = Normalize.parseProviderJson(payload, "codex");
  const agy = Normalize.parseProviderJson(payload, "antigravity");
  assert.equal(codex.ok, true);
  assert.equal(codex.record.summaryUsedPercent, 28);
  assert.equal(agy.ok, false);
  assert.equal(agy.error, "Antigravity language server not detected");
});

test("accepts legacy paths and flat extra windows", () => {
  const result = Normalize.normalizeProviderPayload({
    provider: "antigravity",
    source: "local",
    rate_limits: {
      primary: { percentUsed: "20", reset_at: "not-a-date" }
    },
    extraRateWindows: [
      { title: "Additional", usagePercent: 65, window_minutes: 60 }
    ]
  }, "antigravity");
  assert.equal(result.ok, true);
  assert.equal(result.record.windows.length, 2);
  assert.equal(result.record.windows[0].resetText, "not-a-date");
  assert.equal(result.record.summaryUsedPercent, 65);
});

test("dedup prefers known usage, reset metadata, and later ties", () => {
  const base = {
    label: "Same Window",
    resetsAt: new Date("2026-07-20T00:00:00Z"),
    resetText: null,
    windowMinutes: 300
  };
  const windows = Normalize.deduplicateWindows([
    { ...base, id: "unknown", usedPercent: 90, usageKnown: false, rawIndex: 0 },
    { ...base, id: "known-first", usedPercent: 20, usageKnown: true, rawIndex: 1 },
    { ...base, id: "known-later", usedPercent: 25, usageKnown: true, rawIndex: 2 }
  ]);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].id, "known-later");
});

test("generated IDs are stable when extra-window order changes", () => {
  const first = Normalize.normalizeWindow("antigravity", {
    title: "Gemini Session",
    window: { usedPercent: 20, resetsAt: "2026-07-20T00:00:00Z", windowMinutes: 300 }
  }, "extra-0", 0);
  const reordered = Normalize.normalizeWindow("antigravity", {
    title: "Gemini Session",
    window: { usedPercent: 30, resetsAt: "2026-07-20T00:00:00Z", windowMinutes: 300 }
  }, "extra-7", 7);
  assert.equal(first.id, reordered.id);
});

test("stale state handles initial failure, failure after success, timeout age, and recovery", () => {
  const t0 = new Date("2026-07-15T00:00:00Z");
  const record = Normalize.parseProviderJson(
    JSON.stringify({ provider: "codex", usage: { primary: { usedPercent: 28 } } }),
    "codex"
  ).record;

  const initialFailure = Normalize.settleProviderState(
    Normalize.createProviderState(), { ok: false, error: "failed" }, t0
  );
  assert.equal(initialFailure.record, null);
  assert.equal(initialFailure.error, "failed");

  const success = Normalize.settleProviderState(initialFailure, { ok: true, record }, t0);
  assert.equal(success.record.stale, false);
  const failed = Normalize.settleProviderState(success, { ok: false, error: "offline" }, new Date(t0.getTime() + 60_000));
  assert.equal(failed.record.summaryUsedPercent, 28);
  assert.equal(failed.record.stale, true);
  assert.equal(failed.error, "offline");

  const aged = Normalize.providerViewState(success, new Date(t0.getTime() + 181_000), 60);
  assert.equal(aged.record.stale, true);

  const recovered = Normalize.settleProviderState(failed, { ok: true, record }, new Date(t0.getTime() + 240_000));
  assert.equal(recovered.record.stale, false);
  assert.equal(recovered.error, null);
});

test("valid stdout JSON wins even when the process exits nonzero", () => {
  const result = Normalize.normalizeProcessOutput(
    JSON.stringify({ provider: "codex", usage: { primary: { usedPercent: 7 } } }),
    "backend also wrote stderr",
    17,
    "codex"
  );
  assert.equal(result.ok, true);
  assert.equal(result.record.summaryUsedPercent, 7);
});

test("empty process output keeps stderr or a status-only error", () => {
  assert.equal(Normalize.normalizeProcessOutput("", "backend failed", 2, "codex").error, "backend failed");
  assert.equal(Normalize.normalizeProcessOutput("", "", 9, "codex").error, "CodexBar exited with status 9");
});
