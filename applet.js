const Applet = imports.ui.applet;
const AppletManager = imports.ui.appletManager;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const St = imports.gi.St;

class CodexAgyUsageApplet extends Applet.TextIconApplet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this.setAllowedLayout(Applet.AllowedLayout.BOTH);
        this.orientation = orientation;
        this._destroyed = false;
        this._refreshTimerId = 0;
        this._initializingSettings = true;

        const scopedImports = AppletManager.applets[metadata.uuid];
        this.Constants = scopedImports.lib.constants;
        this.Normalize = scopedImports.lib.normalize;
        this.Normalize.configureConstants(this.Constants);
        this.Format = scopedImports.lib.usageFormat;

        this.runtime = {};
        this.Constants.PROVIDER_ORDER.forEach((providerId) => {
            this.runtime[providerId] = {
                data: this.Normalize.createProviderState(),
                refreshing: false,
                process: null,
                cancellable: null,
                timeoutId: 0,
                requestId: 0,
                failureRecord: null
            };
        });

        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menuManager.addMenu(this.menu);

        this.hide_applet_icon();
        this.set_applet_label("C ?  A ?");

        this.settings = new Settings.AppletSettings(this, metadata.uuid, instanceId);
        this.settings.bind("command-path", "commandPath", this._onSettingsChanged.bind(this));
        this.settings.bind("enable-codex", "enableCodex", this._onSettingsChanged.bind(this));
        this.settings.bind("enable-antigravity", "enableAntigravity", this._onSettingsChanged.bind(this));
        this.settings.bind("refresh-interval", "refreshInterval", this._onSettingsChanged.bind(this));
        this.settings.bind("display-mode", "displayMode", this._onSettingsChanged.bind(this));
        this._initializingSettings = false;

        this._applySettings();
        this._render();
        this._refreshAll(false);
        this._scheduleRefresh();
    }

    on_applet_clicked() {
        this._buildMenu();
        this.menu.toggle();
    }

    on_orientation_changed(orientation) {
        this.orientation = orientation;
        this._render();
    }

    on_applet_removed_from_panel() {
        this._destroyed = true;
        this._clearRefreshTimer();
        this.Constants.PROVIDER_ORDER.forEach((providerId) => this._cancelProvider(providerId));
        if (this.settings) this.settings.finalize();
    }

    _onSettingsChanged() {
        if (this._initializingSettings || this._destroyed) return;
        this._applySettings();
        this._clearRefreshTimer();
        this._render();
        this._refreshAll(false);
        this._scheduleRefresh();
    }

    _applySettings() {
        this.commandPath = String(this.commandPath || this.Constants.DEFAULT_COMMAND).trim() ||
            this.Constants.DEFAULT_COMMAND;
        this.refreshInterval = Math.max(
            this.Constants.MIN_REFRESH_SECONDS,
            Math.min(this.Constants.MAX_REFRESH_SECONDS, Number(this.refreshInterval) || this.Constants.DEFAULT_REFRESH_SECONDS)
        );
        this.displayMode = this.displayMode === "remaining" ? "remaining" : "used";
        this.enableCodex = this.enableCodex !== false;
        this.enableAntigravity = this.enableAntigravity !== false;
    }

    _providerEnabled(providerId) {
        return providerId === "codex" ? this.enableCodex : this.enableAntigravity;
    }

    _scheduleRefresh() {
        this._clearRefreshTimer();
        this._refreshTimerId = Mainloop.timeout_add_seconds(this.refreshInterval, () => {
            if (this._destroyed) return false;
            this._refreshAll(false);
            return true;
        });
    }

    _clearRefreshTimer() {
        if (!this._refreshTimerId) return;
        Mainloop.source_remove(this._refreshTimerId);
        this._refreshTimerId = 0;
    }

    _refreshAll(manual) {
        if (this._destroyed) return;
        this.Constants.PROVIDER_ORDER.forEach((providerId) => {
            if (this._providerEnabled(providerId)) this._refreshProvider(providerId);
        });
        if (manual) this._scheduleRefresh();
        this._render();
    }

    _candidateCommandPaths() {
        const home = GLib.get_home_dir();
        return [
            "/usr/local/bin/codexbar",
            "/usr/bin/codexbar",
            GLib.build_filenamev([home, ".local", "bin", "codexbar"]),
            "/home/linuxbrew/.linuxbrew/bin/codexbar",
            "/opt/apps/codexbar/codexbar"
        ];
    }

    _isExecutable(path) {
        return path && GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE);
    }

    _resolveCommandPath() {
        let configured = this.commandPath;
        if (configured.indexOf("~/") === 0) {
            configured = GLib.build_filenamev([GLib.get_home_dir(), configured.slice(2)]);
        }
        if (configured.indexOf("/") >= 0) return this._isExecutable(configured) ? configured : null;

        const found = GLib.find_program_in_path(configured);
        if (found && this._isExecutable(found)) return found;
        const candidates = this._candidateCommandPaths();
        for (let i = 0; i < candidates.length; i++) {
            if (this._isExecutable(candidates[i])) return candidates[i];
        }
        return null;
    }

    _providerArgv(command, providerId) {
        const argv = [command, "usage", "--provider", providerId];
        if (providerId === "antigravity") argv.push("--source", "auto");
        argv.push("--format", "json");
        return argv;
    }

    _refreshProvider(providerId) {
        const runtime = this.runtime[providerId];
        if (runtime.refreshing || this._destroyed) return;

        const command = this._resolveCommandPath();
        if (!command) {
            this._settleProvider(providerId, {
                ok: false,
                error: "CodexBar CLI not found",
                record: null
            });
            return;
        }

        runtime.refreshing = true;
        runtime.requestId += 1;
        const requestId = runtime.requestId;
        const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;

        try {
            const process = new Gio.Subprocess({
                argv: this._providerArgv(command, providerId),
                flags
            });
            process.init(null);
            const cancellable = new Gio.Cancellable();
            runtime.process = process;
            runtime.cancellable = cancellable;
            runtime.timeoutId = Mainloop.timeout_add_seconds(this.Constants.REFRESH_TIMEOUT_SECONDS, () => {
                if (!runtime.refreshing || runtime.requestId !== requestId) return false;
                runtime.timeoutId = 0;
                try { process.force_exit(); } catch (_error) { /* already exited */ }
                try { cancellable.cancel(); } catch (_error) { /* already cancelled */ }
                this._finishProvider(providerId, requestId, {
                    ok: false,
                    error: "Refresh timed out",
                    record: null
                });
                return false;
            });

            process.communicate_utf8_async(null, cancellable, (object, result) => {
                if (!runtime.refreshing || runtime.requestId !== requestId || this._destroyed) return;
                let stdout = "";
                let stderr = "";
                try {
                    const completed = object.communicate_utf8_finish(result);
                    stdout = completed[1] || "";
                    stderr = completed[2] || "";
                } catch (error) {
                    this._finishProvider(providerId, requestId, {
                        ok: false,
                        error: this._friendlyError(providerId, error.message),
                        record: null
                    });
                    return;
                }

                let exitStatus = null;
                try {
                    if (object.get_if_exited()) exitStatus = object.get_exit_status();
                    else if (object.get_if_signaled()) exitStatus = 128 + object.get_term_sig();
                } catch (_error) { /* status is diagnostic only */ }
                const normalized = this.Normalize.normalizeProcessOutput(stdout, stderr, exitStatus, providerId);
                if (!normalized.ok) normalized.error = this._friendlyError(providerId, normalized.error);
                this._finishProvider(providerId, requestId, normalized);
            });
        } catch (error) {
            this._finishProvider(providerId, requestId, {
                ok: false,
                error: this._friendlyError(providerId, error.message),
                record: null
            });
        }
    }

    _friendlyError(providerId, value) {
        const sanitized = this.Format.sanitizeError(value, GLib.get_home_dir(), 300);
        const lower = sanitized.toLowerCase();
        if (lower.indexOf("timed out") >= 0 || lower.indexOf("timeout") >= 0) return "Refresh timed out";
        if (lower.indexOf("invalid codexbar json") >= 0) return "Invalid CodexBar JSON";
        if (lower.indexOf("provider data not returned") >= 0) return "Provider data not returned";
        if (providerId === "antigravity" &&
            (lower.indexOf("language server") >= 0 || lower.indexOf("agy") >= 0 || lower.indexOf("not running") >= 0)) {
            return "Start Antigravity or agy";
        }
        return sanitized;
    }

    _settleProvider(providerId, result) {
        const runtime = this.runtime[providerId];
        runtime.failureRecord = result && !result.ok ? result.record : null;
        runtime.data = this.Normalize.settleProviderState(runtime.data, result, new Date());
        this._render();
    }

    _finishProvider(providerId, requestId, result) {
        const runtime = this.runtime[providerId];
        if (!runtime.refreshing || runtime.requestId !== requestId) return;
        if (runtime.timeoutId) {
            Mainloop.source_remove(runtime.timeoutId);
            runtime.timeoutId = 0;
        }
        runtime.refreshing = false;
        runtime.process = null;
        runtime.cancellable = null;
        this._settleProvider(providerId, result);
    }

    _cancelProvider(providerId) {
        const runtime = this.runtime[providerId];
        if (runtime.timeoutId) {
            Mainloop.source_remove(runtime.timeoutId);
            runtime.timeoutId = 0;
        }
        if (runtime.cancellable) {
            try { runtime.cancellable.cancel(); } catch (_error) { /* already cancelled */ }
        }
        if (runtime.process) {
            try { runtime.process.force_exit(); } catch (_error) { /* already exited */ }
        }
        runtime.refreshing = false;
        runtime.process = null;
        runtime.cancellable = null;
    }

    _viewState(providerId) {
        return this.Normalize.providerViewState(
            this.runtime[providerId].data,
            new Date(),
            this.refreshInterval
        );
    }

    _panelToken(providerId) {
        const metadata = this.Constants.PROVIDERS[providerId];
        const state = this._viewState(providerId);
        let value = "?";
        if (state.record) {
            const displayed = this.Format.displayPercent(state.record.summaryUsedPercent, this.displayMode);
            value = displayed === null ? "?" : `${displayed}%`;
            if (state.record.stale) value += "~";
        } else if (state.error) {
            value = "!";
        }
        return `${metadata.shortTitle} ${value}`;
    }

    _isHorizontal() {
        return this.orientation === St.Side.TOP || this.orientation === St.Side.BOTTOM;
    }

    _render() {
        if (this._destroyed) return;
        const enabled = this.Constants.PROVIDER_ORDER.filter((providerId) => this._providerEnabled(providerId));
        const separator = this._isHorizontal() ? "  " : "\n";
        this.set_applet_label(enabled.length > 0 ? enabled.map((providerId) => this._panelToken(providerId)).join(separator) : "Usage off");
        this._applyPanelSeverity(enabled);
        this.set_applet_tooltip(this._tooltip(enabled));
        this._buildMenu();
    }

    _applyPanelSeverity(enabledProviders) {
        ["normal", "warning", "danger", "unknown", "error"].forEach((name) => {
            this.actor.remove_style_class_name(`codex-agy-panel-${name}`);
        });
        let severity = "unknown";
        let highest = -1;
        enabledProviders.forEach((providerId) => {
            const state = this._viewState(providerId);
            if (!state.record && state.error) {
                severity = "error";
                highest = 4;
                return;
            }
            if (!state.record || state.record.summaryUsedPercent === null || highest >= 4) return;
            const candidate = this.Format.usageSeverity(state.record.summaryUsedPercent);
            const rank = { unknown: 0, normal: 1, warning: 2, danger: 3 }[candidate];
            if (rank > highest) {
                highest = rank;
                severity = candidate;
            }
        });
        this.actor.add_style_class_name(`codex-agy-panel-${severity}`);
    }

    _tooltip(enabledProviders) {
        const lines = [];
        enabledProviders.forEach((providerId) => {
            const runtime = this.runtime[providerId];
            const state = this._viewState(providerId);
            const title = this.Constants.PROVIDERS[providerId].title;
            if (state.record) {
                let line = `${title}: ${this.Format.percentText(state.record.summaryUsedPercent, this.displayMode)}`;
                if (state.record.stale) line += " (stale)";
                lines.push(line);
                if (state.record.stale && state.lastSuccessAt) lines.push(`Last success: ${this.Format.formatClock(state.lastSuccessAt)}`);
            } else {
                lines.push(`${title}: ${state.error || "Waiting for data"}`);
            }
            if (state.error && state.record) lines.push(`Error: ${state.error}`);
            if (runtime.refreshing) lines.push(`${title}: refreshing`);
        });
        return lines.join("\n") || "Codex & Antigravity usage is disabled";
    }

    _buildMenu() {
        if (!this.menu || this._destroyed) return;
        this.menu.removeAll();
        const enabled = this.Constants.PROVIDER_ORDER.filter((providerId) => this._providerEnabled(providerId));
        if (enabled.length === 0) {
            this._addMessage("Both providers are disabled.", "codex-agy-muted");
        } else {
            enabled.forEach((providerId, index) => {
                if (index > 0) this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                this._addProviderCard(providerId);
            });
        }
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const refresh = new PopupMenu.PopupIconMenuItem("Refresh now", "view-refresh", St.IconType.SYMBOLIC);
        refresh.connect("activate", () => this._refreshAll(true));
        this.menu.addMenuItem(refresh);
        this._addMessage(`Updated: ${this._latestSuccessText()}`, "codex-agy-muted");
    }

    _addProviderCard(providerId) {
        const runtime = this.runtime[providerId];
        const state = this._viewState(providerId);
        const record = state.record || runtime.failureRecord;
        const item = new PopupMenu.PopupBaseMenuItem({ reactive: false, style_class: "codex-agy-popup-item" });
        const card = new St.BoxLayout({ vertical: true, style_class: "codex-agy-card" });
        const heading = new St.BoxLayout({ vertical: false });
        const title = new St.Label({ text: this.Constants.PROVIDERS[providerId].title, style_class: "codex-agy-title" });
        const source = new St.Label({ text: record ? record.source : "", style_class: "codex-agy-muted" });
        title.x_expand = true;
        heading.add_actor(title);
        heading.add_actor(source);
        card.add_actor(heading);

        const subtitleParts = [];
        if (record && record.plan) subtitleParts.push(record.plan);
        if (runtime.refreshing) subtitleParts.push("Refreshing…");
        else if (state.record && state.record.stale) subtitleParts.push("Stale data");
        if (subtitleParts.length > 0) card.add_actor(new St.Label({
            text: subtitleParts.join(" · "),
            style_class: "codex-agy-subtitle"
        }));

        if (state.record && state.record.windows.length > 0) {
            state.record.windows.forEach((window) => card.add_actor(this._windowActor(window)));
        } else {
            card.add_actor(this._messageLabel(state.error || "Waiting for data", state.error ? "codex-agy-error" : "codex-agy-muted"));
        }
        if (state.error && state.record) card.add_actor(this._messageLabel(`Error: ${state.error}`, "codex-agy-error"));
        if (state.lastSuccessAt) {
            card.add_actor(this._messageLabel(`Updated: ${this.Format.formatClock(state.lastSuccessAt)}`, "codex-agy-muted"));
        } else if (state.lastAttemptAt) {
            card.add_actor(this._messageLabel(`Attempted: ${this.Format.formatClock(state.lastAttemptAt)}`, "codex-agy-muted"));
        }

        item.addActor(card, { span: -1, expand: true });
        this.menu.addMenuItem(item);
    }

    _windowActor(window) {
        const box = new St.BoxLayout({ vertical: true, style_class: "codex-agy-window" });
        const heading = new St.BoxLayout({ vertical: false });
        const label = new St.Label({ text: window.label, style_class: "codex-agy-window-title" });
        const percent = new St.Label({
            text: window.usageKnown ? this.Format.percentText(window.usedPercent, this.displayMode) : "Usage unknown",
            style_class: window.usageKnown ? "codex-agy-detail" : "codex-agy-muted"
        });
        label.x_expand = true;
        heading.add_actor(label);
        heading.add_actor(percent);
        box.add_actor(heading);

        if (window.usageKnown) box.add_actor(this._progressBar(window.usedPercent));
        else box.add_actor(new St.Label({ text: "Usage unavailable", style_class: "codex-agy-unknown-bar" }));

        const reset = this.Format.formatReset(window, new Date());
        if (reset) box.add_actor(new St.Label({ text: reset, style_class: "codex-agy-reset" }));
        return box;
    }

    _progressBar(usedPercent) {
        const clamped = Math.max(0, Math.min(100, Number(usedPercent)));
        const severity = this.Format.usageSeverity(clamped);
        const track = new St.BoxLayout({ style_class: "codex-agy-progress-track" });
        const fill = new St.Bin({ style_class: `codex-agy-progress-fill codex-agy-progress-${severity}` });
        track.x_expand = true;
        track.add_actor(fill);
        track.connect("notify::allocation", () => {
            const width = track.get_width();
            fill.set_width(clamped > 0 ? Math.max(3, Math.round(width * clamped / 100)) : 0);
        });
        return track;
    }

    _messageLabel(text, styleClass) {
        const label = new St.Label({ text: String(text), style_class: styleClass });
        label.clutter_text.line_wrap = true;
        return label;
    }

    _addMessage(text, styleClass) {
        const item = new PopupMenu.PopupMenuItem(String(text), { reactive: false });
        item.label.add_style_class_name(styleClass);
        item.label.clutter_text.line_wrap = true;
        this.menu.addMenuItem(item);
    }

    _latestSuccessText() {
        let latest = null;
        this.Constants.PROVIDER_ORDER.forEach((providerId) => {
            const date = this.runtime[providerId].data.lastSuccessAt;
            if (date && (!latest || date.getTime() > latest.getTime())) latest = date;
        });
        return this.Format.formatClock(latest);
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new CodexAgyUsageApplet(metadata, orientation, panelHeight, instanceId);
}
