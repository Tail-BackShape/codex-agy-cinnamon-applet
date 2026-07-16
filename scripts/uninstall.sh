#!/usr/bin/env bash
set -euo pipefail

UUID="codex-agy-usage@local"
TARGET="${HOME}/.local/share/cinnamon/applets/${UUID}"

if [[ -L "$TARGET" ]]; then
    unlink -- "$TARGET"
    printf 'Removed applet symlink: %s\n' "$TARGET"
elif [[ -e "$TARGET" ]]; then
    printf 'Refusing to remove a real file or directory: %s\n' "$TARGET" >&2
    exit 1
else
    printf 'Applet is not installed: %s\n' "$TARGET"
fi

printf 'CodexBar, Codex CLI, Antigravity, agy, and authentication data were not changed.\n'
