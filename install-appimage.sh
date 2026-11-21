#!/bin/sh
# Compatibility entry point for the first AppImage release.
set -eu
case "$0" in
  */install-appimage.sh|install-appimage.sh)
    installer="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)/install.sh"
    if [ -f "$installer" ]; then exec sh "$installer" "$@"; fi
    ;;
esac
installer=$(mktemp)
trap 'rm -f -- "$installer"' EXIT
trap 'exit 1' HUP INT TERM
curl -fsSL --retry 3 https://raw.githubusercontent.com/gmrodrigues/Recall.md/main/install.sh -o "$installer"
sh "$installer" "$@"
