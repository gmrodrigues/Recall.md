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

resolved=$(command -v recall-appimage || :)
if [ -n "$resolved" ] && [ "$resolved" -ef "$bin_dir/recall-appimage" ]; then
  printf '%s\n' 'O comando recall-appimage já está disponível no PATH.'
  exit 0
fi

# When piped to sh, the parent is usually the shell the user is running.
shell=$(ps -p "${PPID:-0}" -o comm= 2>/dev/null | tr -d '[:space:]')
case "$shell" in
  bash|zsh|fish|ksh|mksh|csh|tcsh|nu) ;;
  *) shell=${SHELL:-}; shell=${shell##*/} ;;
esac
case "$shell" in
  bash) config="$HOME/.bashrc"; line='export PATH="$HOME/.local/bin:$PATH"' ;;
  zsh) config="${ZDOTDIR:-$HOME}/.zshrc"; line='export PATH="$HOME/.local/bin:$PATH"' ;;
  fish) config="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"; line='fish_add_path --move --path "$HOME/.local/bin"' ;;
  sh|dash|ksh|mksh|'') config="${ENV:-$HOME/.profile}"; line='export PATH="$HOME/.local/bin:$PATH"' ;;
  csh) config="$HOME/.cshrc"; line='set path = ( "$HOME/.local/bin" $path )' ;;
  tcsh) config="$HOME/.tcshrc"; line='set path = ( "$HOME/.local/bin" $path )' ;;
  *)
    printf 'Inclua %s no início do PATH na configuração do shell %s.\n' "$bin_dir" "$shell"
    printf 'Para executar agora: "%s/recall-appimage"\n' "$bin_dir"
    exit 0
    ;;
esac
if [ -n "$resolved" ]; then
  printf 'O PATH encontra outra cópia antes desta: %s\n' "$resolved"
else
  printf '%s\n' 'O comando recall-appimage ainda não está no PATH.'
fi
printf 'Adicione esta linha em %s e abra um novo terminal:\n\n  %s\n' "$config" "$line"
printf '\nPara usar neste terminal, execute a mesma linha ou chame "%s/recall-appimage".\n' "$bin_dir"
