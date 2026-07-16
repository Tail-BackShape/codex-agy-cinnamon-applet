#!/usr/bin/env bash
set -euo pipefail

UUID="codex-agy-usage@local"
FORCE=0

usage() {
    printf 'Usage: %s [--force]\n' "$0"
}

for argument in "$@"; do
    case "$argument" in
        --force) FORCE=1 ;;
        -h|--help) usage; exit 0 ;;
        *) printf 'Unknown option: %s\n' "$argument" >&2; usage >&2; exit 2 ;;
    esac
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
APPLET_DIR="${HOME}/.local/share/cinnamon/applets"
TARGET="${APPLET_DIR}/${UUID}"

find_codexbar() {
    if command -v codexbar >/dev/null 2>&1; then
        command -v codexbar
        return 0
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
            return 0
        fi
    done
    return 1
}

if CODEXBAR_PATH="$(find_codexbar)"; then
    printf 'CodexBar: %s\n' "$CODEXBAR_PATH"
else
    printf 'Warning: CodexBar CLI was not found. Install it before using the applet.\n' >&2
fi

mkdir -p -- "$APPLET_DIR"

if [[ -L "$TARGET" ]]; then
    CURRENT="$(readlink -f -- "$TARGET")"
    if [[ "$CURRENT" == "$PROJECT_DIR" ]]; then
        printf 'Already installed: %s\n' "$TARGET"
        exit 0
    fi
    if [[ "$FORCE" -ne 1 ]]; then
        printf 'Refusing to replace symlink to another project: %s -> %s\n' "$TARGET" "$CURRENT" >&2
        printf 'Re-run with --force to replace that symlink only.\n' >&2
        exit 1
    fi
    unlink -- "$TARGET"
elif [[ -e "$TARGET" ]]; then
    printf 'Refusing to replace a real file or directory: %s\n' "$TARGET" >&2
    printf 'Back it up and remove it manually if replacement is intended.\n' >&2
    exit 1
fi

ln -s -- "$PROJECT_DIR" "$TARGET"
printf 'Installed symlink: %s -> %s\n' "$TARGET" "$PROJECT_DIR"
printf 'Open System Settings -> Applets -> Codex & Antigravity Usage -> Add.\n'
