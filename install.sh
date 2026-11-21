#!/bin/sh
set -eu

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) asset=Recall.md-x86_64.AppImage ;;
  *) printf '%s\n' 'Esta AppImage está disponível para Linux x86_64.' >&2; exit 1 ;;
esac
bin_dir="${HOME:?HOME não definido}/.local/bin"
mkdir -p "$bin_dir"
stage=$(mktemp -d "$bin_dir/.recall-appimage.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
trap 'exit 1' HUP INT TERM
release=https://github.com/gmrodrigues/Recall.md/releases/latest/download
curl -fsSL --retry 3 "$release/$asset" -o "$stage/$asset"
curl -fsSL --retry 3 "$release/$asset.sha256" -o "$stage/$asset.sha256"
(
  cd "$stage"
  sha256sum --strict --check "$asset.sha256"
)
chmod 755 "$stage/$asset"
mv -fT -- "$stage/$asset" "$bin_dir/recall-appimage"
printf 'Instalado: %s/recall-appimage\n' "$bin_dir"
