#!/usr/bin/env bash
# Set the lock-screen passcode fallback without the passcode ever touching disk or shell history.
# Prompts twice (hidden input) and writes only its SHA-256 into _config.yml (passcode_hash).
set -euo pipefail
cd "$(dirname "$0")/.."
read -rsp "New passcode (min 8 chars): " p1; echo
read -rsp "Repeat passcode: " p2; echo
[[ "$p1" == "$p2" ]] || { echo "Passcodes did not match — nothing changed."; exit 1; }
[[ ${#p1} -ge 8 ]] || { echo "Use at least 8 characters (the hash is public in the repo)."; exit 1; }
hash=$(printf '%s' "$p1" | sha256sum | cut -d' ' -f1)
unset p1 p2
sed -i -E "s/^passcode_hash: \".*\"/passcode_hash: \"$hash\"/" _config.yml
echo "passcode_hash updated in _config.yml. Commit and push to apply."
