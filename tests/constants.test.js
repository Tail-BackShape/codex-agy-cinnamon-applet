const assert = require("node:assert/strict");
const test = require("node:test");

const Constants = require("../lib/constants");

test("registers Devin as a visible provider", () => {
  assert.deepEqual(Constants.PROVIDERS.devin, {
    id: "devin",
    title: "Devin",
    shortTitle: "D"
  });
  assert.deepEqual(Constants.PROVIDER_ORDER, ["codex", "antigravity", "devin"]);
});
