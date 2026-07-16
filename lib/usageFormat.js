function roundedPercent(value) {
    return Math.round(Math.max(0, Math.min(100, Number(value))));
}

function displayPercent(usedPercent, displayMode) {
    if (usedPercent === null || usedPercent === undefined || !Number.isFinite(Number(usedPercent))) return null;
    const used = roundedPercent(usedPercent);
    return displayMode === "remaining" ? 100 - used : used;
}

function percentText(usedPercent, displayMode) {
    const value = displayPercent(usedPercent, displayMode);
    if (value === null) return "Usage unknown";
    return `${value}% ${displayMode === "remaining" ? "remaining" : "used"}`;
}

function relativeReset(date, now) {
    const deltaMinutes = Math.floor((date.getTime() - now.getTime()) / 60000);
    if (deltaMinutes <= 0) return "reset due";
    if (deltaMinutes < 60) return `reset in ${deltaMinutes}m`;
    const days = Math.floor(deltaMinutes / 1440);
    const hours = Math.floor((deltaMinutes % 1440) / 60);
    const minutes = deltaMinutes % 60;
    if (days > 0) return `reset in ${days}d${hours > 0 ? ` ${hours}h` : ""}`;
    return `reset in ${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
}

function formatReset(window, now) {
    const current = now instanceof Date ? now : new Date(now || Date.now());
    if (window && window.resetsAt instanceof Date && !Number.isNaN(window.resetsAt.getTime())) {
        return relativeReset(window.resetsAt, current);
    }
    if (window && window.resetText) {
        const text = String(window.resetText).trim();
        return /^reset/i.test(text) ? text : `reset ${text}`;
    }
    return "";
}

function formatClock(date) {
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString() : "never";
}

function usageSeverity(usedPercent) {
    if (usedPercent === null || usedPercent === undefined || !Number.isFinite(Number(usedPercent))) return "unknown";
    const used = Number(usedPercent);
    if (used >= 85) return "danger";
    if (used >= 65) return "warning";
    return "normal";
}

function sanitizeError(value, homeDirectory, maxLength) {
    let text = String(value || "Unknown error").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
    if (homeDirectory) text = text.split(String(homeDirectory)).join("~");
    text = text
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<redacted-email>")
        .replace(/\bBearer\s+[^\s]+/gi, "Bearer <redacted>")
        .replace(/\b(?:access|refresh)[_-]?token\s*[:=]\s*[^\s,;]+/gi, "token=<redacted>")
        .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "<redacted-token>");
    const limit = Number(maxLength || 300);
    return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text;
}

if (typeof module !== "undefined") {
    module.exports = {
        displayPercent,
        percentText,
        formatReset,
        formatClock,
        usageSeverity,
        sanitizeError
    };
}

