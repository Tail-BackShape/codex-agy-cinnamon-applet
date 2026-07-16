var APPLET_UUID = "codex-agy-usage@local";
var DEFAULT_COMMAND = "codexbar";
var DEFAULT_REFRESH_SECONDS = 60;
var MIN_REFRESH_SECONDS = 30;
var MAX_REFRESH_SECONDS = 3600;
var REFRESH_TIMEOUT_SECONDS = 25;
var STALE_INTERVAL_MULTIPLIER = 3;

var PROVIDERS = {
    codex: {
        id: "codex",
        title: "Codex",
        shortTitle: "C"
    },
    antigravity: {
        id: "antigravity",
        title: "Antigravity",
        shortTitle: "A"
    }
};

var PROVIDER_ORDER = ["codex", "antigravity"];
var PERCENT_KEYS = ["usedPercent", "percentUsed", "usagePercent", "used_percent"];
var RESET_KEYS = ["resetsAt", "resetAt", "reset_at"];
var RESET_DESCRIPTION_KEYS = ["resetDescription", "reset_description"];

if (typeof module !== "undefined") {
    module.exports = {
        APPLET_UUID,
        DEFAULT_COMMAND,
        DEFAULT_REFRESH_SECONDS,
        MIN_REFRESH_SECONDS,
        MAX_REFRESH_SECONDS,
        REFRESH_TIMEOUT_SECONDS,
        STALE_INTERVAL_MULTIPLIER,
        PROVIDERS,
        PROVIDER_ORDER,
        PERCENT_KEYS,
        RESET_KEYS,
        RESET_DESCRIPTION_KEYS
    };
}
