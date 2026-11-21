#!/usr/bin/env bash
set -euo pipefail

[[ "$(uname -s)-$(uname -m)" == Linux-x86_64 ]] || {
  printf '%s\n' 'O build da AppImage requer Linux x86_64.' >&2
  exit 1
}
cd "$(dirname "${BASH_SOURCE[0]}")/.."
output_dir="${1:-dist}"
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
stage="$(mktemp -d)"
trap 'rm -rf -- "$stage"' EXIT
appdir="$stage/Recall.AppDir"
mkdir -p "$appdir/usr/bin" "$appdir/usr/lib/recall"

npm run build
app="$appdir/usr/lib/recall"
cp -R bin src web "$app/"
mkdir -p "$app/examples/example-vocabulario"
cp examples/primeira-etapa.json "$app/examples/"
cp examples/example-vocabulario/vocabulario-ingles.json "$app/examples/example-vocabulario/"
mkdir "$app/docs"
cp docs/agents.md "$app/docs/"
cp package.json package-lock.json "$app/"
npm ci --prefix "$app" --omit=dev --ignore-scripts --no-audit --no-fund
node_binary="$(command -v node)"
install -m 755 "$node_binary" "$appdir/usr/bin/node"
cp "$(dirname "$node_binary")/../LICENSE" "$appdir/usr/lib/NODE-LICENSE"

cat > "$appdir/AppRun" <<'APPRUN'
#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
cli="$root/usr/lib/recall/bin/recall.js"
node="$root/usr/bin/node"
if [ "$#" -eq 0 ]; then
  study="${XDG_DATA_HOME:-$HOME/.local/share}/recall-md/estudo"
  mkdir -p "$study"
  if [ ! -f "$study/recall/config.yml" ]; then
    "$node" "$cli" --cwd "$study" init
  fi
  set -- --cwd "$study" browser
fi
exec "$node" "$cli" "$@"
APPRUN
chmod +x "$appdir/AppRun"

cat > "$appdir/recall-md.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Recall.md
Exec=recall-md
Icon=recall-md
Categories=Education;
Terminal=true
DESKTOP
cat > "$appdir/recall-md.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect x="8" y="8" width="112" height="112" rx="24" fill="#145b47"/>
  <path d="M39 92V38h13v9c5-7 13-11 24-10v14c-16-2-23 5-23 18v23z" fill="#fff"/>
  <circle cx="83" cy="85" r="8" fill="#fff"/>
</svg>
SVG

tool="$stage/appimagetool.AppImage"
curl -fsSL --retry 3 https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage -o "$tool"
printf '%s  %s\n' ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0 "$tool" | sha256sum -c -
chmod +x "$tool"
asset=Recall.md-x86_64.AppImage
ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 "$tool" "$appdir" "$output_dir/$asset"
(
  cd "$output_dir"
  sha256sum "$asset" > "$asset.sha256"
)
