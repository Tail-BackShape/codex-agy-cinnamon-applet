const assert = require("node:assert/strict");
const test = require("node:test");

const Format = require("../lib/usageFormat");

test("formats used and remaining percentages without changing severity", () => {
  assert.equal(Format.displayPercent(28, "used"), 28);
  assert.equal(Format.displayPercent(28, "remaining"), 72);
  assert.equal(Format.percentText(28, "used"), "28% used");
  assert.equal(Format.percentText(28, "remaining"), "72% remaining");
  assert.equal(Format.percentText(null, "used"), "Usage unknown");
  assert.equal(Format.usageSeverity(86), "danger");
  assert.equal(Format.usageSeverity(70), "warning");
  assert.equal(Format.usageSeverity(28), "normal");
  assert.equal(Format.usageSeverity(null), "unknown");
});

test("formats relative and raw reset values", () => {
  const now = new Date("2026-07-15T12:00:00Z");
  assert.equal(Format.formatReset({ resetsAt: new Date("2026-07-15T14:14:00Z") }, now), "reset in 2h 14m");
  assert.equal(Format.formatReset({ resetsAt: new Date("2026-07-18T20:00:00Z") }, now), "reset in 3d 8h");
  assert.equal(Format.formatReset({ resetText: "next Tuesday" }, now), "reset next Tuesday");
});

test("sanitizes and truncates error messages", () => {
  const message = Format.sanitizeError(
    "failed for user@example.com in /home/example/private with Bearer abc.def.ghi",
    "/home/example",
    80
  );
  assert.equal(message.includes("user@example.com"), false);
  assert.equal(message.includes("/home/example"), false);
  assert.equal(message.includes("Bearer abc"), false);
  assert.ok(message.length <= 80);
});
