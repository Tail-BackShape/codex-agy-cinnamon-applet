var Constants = typeof module !== "undefined" ? require("./constants") : null;

function configureConstants(constants) {
    Constants = constants;
}

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getPath(value, path) {
    let cursor = value;
    for (let i = 0; i < path.length; i++) {
        if (!isObject(cursor) || !Object.prototype.hasOwnProperty.call(cursor, path[i])) return null;
        cursor = cursor[path[i]];
    }
    return cursor;
}

function firstValue(value, keys) {
    if (!isObject(value)) return null;
    for (let i = 0; i < keys.length; i++) {
        if (Object.prototype.hasOwnProperty.call(value, keys[i]) && value[keys[i]] !== null && value[keys[i]] !== undefined) {
            return value[keys[i]];
        }
    }
    return null;
}

function firstNumber(value, keys) {
    if (!isObject(value)) return null;
    for (let i = 0; i < keys.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(value, keys[i])) continue;
        const candidate = value[keys[i]];
        if (candidate === null || candidate === undefined || candidate === "") continue;
        const number = Number(candidate);
        if (Number.isFinite(number)) return number;
    }
    return null;
}

function clampPercent(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.max(0, Math.min(100, number));
}

function parseDate(value) {
    if (value === null || value === undefined || value === "") return null;
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function errorMessage(error) {
    if (!error) return null;
    if (typeof error === "string") return error;
    if (typeof error.message === "string") return error.message;
    if (typeof error.description === "string") return error.description;
    return "Provider refresh failed";
}

function windowPaths(name) {
    return [
        ["usage", name],
        ["usage", "limits", name],
        ["usage", "rateLimits", name],
        ["usage", "rate_limits", name],
        ["limits", name],
        ["rateLimits", name],
        ["rate_limits", name],
        [name]
    ];
}

function slotWindow(record, name) {
    const paths = windowPaths(name);
    for (let i = 0; i < paths.length; i++) {
        const value = getPath(record, paths[i]);
        if (isObject(value)) return value;
    }
    return null;
}

function extraWindows(record) {
    const paths = [
        ["usage", "extraRateWindows"],
        ["usage", "limits", "extraRateWindows"],
        ["usage", "rateLimits", "extraRateWindows"],
        ["usage", "rate_limits", "extraRateWindows"],
        ["extraRateWindows"]
    ];
    for (let i = 0; i < paths.length; i++) {
        const value = getPath(record, paths[i]);
        if (Array.isArray(value)) return value;
    }
    return [];
}

function fallbackLabel(providerId, slot) {
    const codex = { primary: "5 hour", secondary: "Weekly", tertiary: "Additional quota" };
    const antigravity = { primary: "Gemini", secondary: "Claude + GPT", tertiary: "Other" };
    const labels = providerId === "antigravity" ? antigravity : codex;
    return labels[slot] || "Usage";
}

function stableSlug(value) {
    const slug = String(value || "usage").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return slug || "usage";
}

function normalizeWindow(providerId, wrapper, slot, rawIndex) {
    if (!isObject(wrapper)) return null;
    const rawWindow = isObject(wrapper.window) ? wrapper.window : wrapper;
    if (rawWindow.isSyntheticPlaceholder === true || wrapper.isSyntheticPlaceholder === true) return null;

    const rawPercent = firstNumber(rawWindow, Constants.PERCENT_KEYS);
    const usedPercent = clampPercent(rawPercent);
    const usageKnown = wrapper.usageKnown !== false && rawWindow.usageKnown !== false && usedPercent !== null;
    const resetValue = firstValue(rawWindow, Constants.RESET_KEYS);
    const resetsAt = parseDate(resetValue);
    const resetDescription = firstValue(rawWindow, Constants.RESET_DESCRIPTION_KEYS);
    const resetText = resetDescription !== null
        ? String(resetDescription)
        : (resetValue !== null && resetsAt === null ? String(resetValue) : null);
    const rawWindowMinutes = firstNumber(rawWindow, ["windowMinutes", "window_minutes", "minutes"]);
    const windowMinutes = rawWindowMinutes !== null && rawWindowMinutes > 0 ? Math.round(rawWindowMinutes) : null;
    const label = String(
        firstValue(wrapper, ["title", "label"]) ||
        firstValue(rawWindow, ["title", "label"]) ||
        fallbackLabel(providerId, slot)
    ).trim();
    const resetIdentity = resetsAt ? resetsAt.toISOString() : (resetText || "no-reset");
    const generatedId = [
        providerId,
        stableSlug(label),
        stableSlug(resetIdentity),
        windowMinutes === null ? "no-window" : `${windowMinutes}m`
    ].join("-");
    const id = String(firstValue(wrapper, ["id", "key"]) || generatedId);

    return {
        id,
        label,
        usedPercent,
        resetsAt,
        resetText,
        windowMinutes,
        usageKnown,
        rawIndex
    };
}

function normalizedDedupLabel(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function dedupKey(window) {
    const reset = window.resetsAt ? window.resetsAt.toISOString() : (window.resetText || "");
    return `${normalizedDedupLabel(window.label)}|${reset}|${window.windowMinutes === null ? "" : window.windowMinutes}`;
}

function candidateScore(window) {
    let score = 0;
    if (window.usageKnown) score += 8;
    if (window.usedPercent !== null) score += 4;
    if (window.resetsAt || window.resetText) score += 2;
    return score;
}

function deduplicateWindows(windows) {
    const byKey = new Map();
    for (let i = 0; i < windows.length; i++) {
        const candidate = windows[i];
        const key = dedupKey(candidate);
        const existing = byKey.get(key);
        if (!existing || candidateScore(candidate) >= candidateScore(existing)) byKey.set(key, candidate);
    }
    return Array.from(byKey.values()).sort((a, b) => a.rawIndex - b.rawIndex);
}

function providerTitle(providerId) {
    return Constants.PROVIDERS[providerId] ? Constants.PROVIDERS[providerId].title : providerId;
}

function normalizeProviderRecord(record, providerId) {
    const usage = isObject(record.usage) ? record.usage : {};
    const rawIdentity = firstValue(usage, ["identity"]) || firstValue(record, ["identity"]);
    const identity = isObject(rawIdentity) ? rawIdentity : {};
    const windows = [];
    let rawIndex = 0;
    ["primary", "secondary", "tertiary"].forEach((slot) => {
        const raw = slotWindow(record, slot);
        const normalized = normalizeWindow(providerId, raw, slot, rawIndex++);
        if (normalized) windows.push(normalized);
    });
    extraWindows(record).forEach((raw, index) => {
        const normalized = normalizeWindow(providerId, raw, `extra-${index}`, rawIndex++);
        if (normalized) windows.push(normalized);
    });

    const uniqueWindows = deduplicateWindows(windows);
    const knownPercentages = uniqueWindows
        .filter((window) => window.usageKnown && window.usedPercent !== null)
        .map((window) => window.usedPercent);
    const account = firstValue(record, ["account", "accountEmail"]) ||
        firstValue(identity, ["accountEmail", "email"]) || firstValue(usage, ["accountEmail", "email"]);
    const planInfo = isObject(record.antigravityPlanInfo) ? record.antigravityPlanInfo : {};
    const plan = firstValue(record, ["plan", "planName"]) || firstValue(usage, ["plan", "planName"]) ||
        firstValue(planInfo, ["plan", "planName", "name"]) || firstValue(identity, ["loginMethod"]) ||
        firstValue(usage, ["loginMethod"]);
    const updatedValue = firstValue(usage, ["updatedAt", "updated_at"]) || firstValue(record, ["updatedAt", "updated_at"]);

    return {
        id: providerId,
        title: providerTitle(providerId),
        source: String(firstValue(record, ["source"]) || "unknown"),
        identity: rawIdentity === null ? null : (isObject(rawIdentity) ? Object.assign({}, rawIdentity) : rawIdentity),
        account: account === null ? null : String(account),
        plan: plan === null ? null : String(plan),
        updatedAt: parseDate(updatedValue),
        windows: uniqueWindows,
        summaryUsedPercent: knownPercentages.length > 0 ? Math.max(...knownPercentages) : null,
        error: errorMessage(record.error),
        stale: false,
        staleSince: null
    };
}

function normalizeProviderPayload(parsed, providerId) {
    const records = Array.isArray(parsed) ? parsed : [parsed];
    const record = records.find((candidate) => isObject(candidate) && candidate.provider === providerId);
    if (!record) return { ok: false, error: "Provider data not returned", record: null };

    const normalized = normalizeProviderRecord(record, providerId);
    if (normalized.error) return { ok: false, error: normalized.error, record: normalized };
    if (normalized.windows.length === 0) {
        const signedIn = normalized.account !== null || normalized.plan !== null;
        return {
            ok: false,
            error: signedIn ? "Signed in; limits unavailable" : "No usage data returned",
            record: normalized
        };
    }
    return { ok: true, error: null, record: normalized };
}

function parseProviderJson(text, providerId) {
    let parsed;
    try {
        parsed = JSON.parse(String(text || ""));
    } catch (_error) {
        return { ok: false, error: "Invalid CodexBar JSON", record: null };
    }
    return normalizeProviderPayload(parsed, providerId);
}

function normalizeProcessOutput(stdout, stderr, exitStatus, providerId) {
    const output = String(stdout || "");
    if (output.trim()) return parseProviderJson(output, providerId);
    const errorOutput = String(stderr || "").trim();
    const status = Number(exitStatus);
    const fallback = Number.isFinite(status) && status !== 0
        ? `CodexBar exited with status ${status}`
        : "CodexBar returned empty output";
    return { ok: false, error: errorOutput || fallback, record: null };
}

function createProviderState() {
    return {
        record: null,
        lastGoodRecord: null,
        lastSuccessAt: null,
        lastAttemptAt: null,
        error: null
    };
}

function settleProviderState(previous, result, now) {
    const state = previous || createProviderState();
    const attemptAt = now instanceof Date ? new Date(now.getTime()) : new Date(now);
    if (result && result.ok && result.record) {
        const good = Object.assign({}, result.record, { stale: false, staleSince: null });
        return {
            record: good,
            lastGoodRecord: good,
            lastSuccessAt: attemptAt,
            lastAttemptAt: attemptAt,
            error: null
        };
    }

    const fallback = state.lastGoodRecord
        ? Object.assign({}, state.lastGoodRecord, { stale: true, staleSince: state.lastSuccessAt || attemptAt })
        : null;
    return {
        record: fallback,
        lastGoodRecord: state.lastGoodRecord,
        lastSuccessAt: state.lastSuccessAt,
        lastAttemptAt: attemptAt,
        error: result && result.error ? String(result.error) : "Provider refresh failed"
    };
}

function providerViewState(state, now, refreshIntervalSeconds) {
    const source = state || createProviderState();
    if (!source.record || !source.lastSuccessAt) return source;
    const current = now instanceof Date ? now : new Date(now);
    const thresholdMs = Math.max(1, Number(refreshIntervalSeconds || Constants.DEFAULT_REFRESH_SECONDS)) *
        Constants.STALE_INTERVAL_MULTIPLIER * 1000;
    if (current.getTime() - source.lastSuccessAt.getTime() <= thresholdMs || source.record.stale) return source;
    return Object.assign({}, source, {
        record: Object.assign({}, source.record, {
            stale: true,
            staleSince: new Date(source.lastSuccessAt.getTime() + thresholdMs)
        })
    });
}

if (typeof module !== "undefined") {
    module.exports = {
        clampPercent,
        configureConstants,
        parseDate,
        normalizeWindow,
        deduplicateWindows,
        normalizeProviderRecord,
        normalizeProviderPayload,
        parseProviderJson,
        normalizeProcessOutput,
        createProviderState,
        settleProviderState,
        providerViewState
    };
}
