#!/usr/bin/env bash
set -u

COMMAND_PATH=""

usage() {
    printf 'Usage: %s [--command PATH]\n' "$0"
}

while [[ "$#" -gt 0 ]]; do
    case "$1" in
        --command)
            if [[ "$#" -lt 2 ]]; then
                printf '%s\n' '--command requires a path' >&2
                exit 2
            fi
            COMMAND_PATH="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            printf 'Unknown option: %s\n' "$1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

find_codexbar() {
    if [[ -n "$COMMAND_PATH" ]]; then
        [[ -x "$COMMAND_PATH" ]] && printf '%s\n' "$COMMAND_PATH"
        return
    fi
    if command -v codexbar >/dev/null 2>&1; then
        command -v codexbar
        return
    fi
    local candidate
    for candidate in \
        /usr/local/bin/codexbar \
        /usr/bin/codexbar \
        "${HOME}/.local/bin/codexbar" \
        /home/linuxbrew/.linuxbrew/bin/codexbar \
        /opt/apps/codexbar/codexbar; do
        if [[ -x "$candidate" ]]; then
            printf '%s\n' "$candidate"
            return
        fi
    done
}

redact_json() {
    jq '
      walk(
        if type == "object" then
          with_entries(
            if (.key | ascii_downcase | test("^(account|accountemail|accountorganization|email|organization|.*token.*|cookie|credentials?|authorization|uuid|session.?id|api.?key|secret)$"))
            then .value = "<redacted>"
            elif (.key == "id" and (.value | type) == "string" and (.value | length) > 40)
            then .value = "<redacted-id>"
            else .
            end
          )
        else .
        end
      )
    ' "$1" | sed "s#${HOME}#/home/USER#g"
}

summarize_json() {
    if command -v node >/dev/null 2>&1; then
        node -e '
          const fs = require("fs");
          try {
            const parsed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
            const records = Array.isArray(parsed) ? parsed : [parsed];
            for (const record of records) {
              if (!record || typeof record !== "object") continue;
              console.log(`provider=${record.provider || "unknown"}`);
              console.log(`source=${record.source || "unknown"}`);
              console.log(`usage=${record.usage ? "present" : "absent"}`);
              console.log(`error=${record.error ? "present" : "absent"}`);
            }
          } catch (_) {
            console.log("json=invalid");
          }
        ' "$1"
    else
        grep -q '"provider"' "$1" && printf 'provider=present\n' || printf 'provider=absent\n'
        grep -q '"source"' "$1" && printf 'source=present\n' || printf 'source=absent\n'
        grep -q '"usage"' "$1" && printf 'usage=present\n' || printf 'usage=absent\n'
        grep -q '"error"' "$1" && printf 'error=present\n' || printf 'error=absent\n'
    fi
}

run_provider() {
    local provider="$1"
    local output_file="$2"
    local error_file="$3"
    local status
    local args=(usage --provider "$provider")
    if [[ "$provider" == "antigravity" ]]; then
        args+=(--source auto)
    fi
    args+=(--format json --pretty)

    timeout 45 "$CODEXBAR" "${args[@]}" >"$output_file" 2>"$error_file"
    status=$?
    printf '%s exit status: %s\n' "$provider" "$status"
    if [[ -s "$output_file" ]]; then
        if command -v jq >/dev/null 2>&1; then
            redact_json "$output_file"
        else
            summarize_json "$output_file"
        fi
    else
        printf 'stdout=empty\n'
    fi
    if [[ -s "$error_file" ]]; then
        printf 'stderr=present (content hidden to avoid leaking credentials)\n'
    fi
}

printf 'OS: '
if [[ -r /etc/os-release ]]; then
    . /etc/os-release
    printf '%s\n' "${PRETTY_NAME:-unknown}"
else
    printf 'unknown\n'
fi
printf 'Cinnamon: '
cinnamon --version 2>/dev/null || printf 'not found\n'
printf 'agy: %s\n' "$(command -v agy 2>/dev/null || printf 'not found')"
if pgrep -af 'antigravity|agy|language[_-]server' >/dev/null 2>&1; then
    printf 'Antigravity-related process: detected\n'
else
    printf 'Antigravity-related process: not detected\n'
fi

CODEXBAR="$(find_codexbar)"
if [[ -z "$CODEXBAR" ]]; then
    printf 'CodexBar: not found\n'
    exit 1
fi
printf 'CodexBar: %s\n' "$CODEXBAR"
"$CODEXBAR" --version 2>/dev/null || true

TMP_DIR="$(mktemp -d)"
chmod 700 "$TMP_DIR"
trap 'rm -rf -- "$TMP_DIR"' EXIT

run_provider codex "$TMP_DIR/codex.json" "$TMP_DIR/codex.err"
run_provider antigravity "$TMP_DIR/antigravity.json" "$TMP_DIR/antigravity.err"
