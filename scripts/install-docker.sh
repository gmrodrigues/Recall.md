#!/bin/sh
# Install the Docker-backed recall command; no Node.js needed on the host.
set -eu
bin_dir=${HOME:?HOME não definido}/.local/bin
case ${1:-} in
  --bin-dir) [ "$#" -eq 2 ] || { echo 'Uso: sh scripts/install-docker.sh [--bin-dir DIRETÓRIO]' >&2; exit 1; }; bin_dir=$2 ;;
  --help|-h) echo 'Uso: sh scripts/install-docker.sh [--bin-dir DIRETÓRIO]'; exit 0 ;;
  '') ;;
  *) echo 'Opção desconhecida.' >&2; exit 1 ;;
esac
command -v docker >/dev/null 2>&1 || { echo 'Instale Docker e disponibilize o comando docker no PATH.' >&2; exit 1; }
docker info </dev/null >/dev/null 2>&1 || { echo 'O daemon Docker precisa estar acessível ao usuário atual.' >&2; exit 1; }
mkdir -p "$bin_dir"
target=$bin_dir/recall.md
if [ -e "$target" ] || [ -L "$target" ]; then
  if [ -L "$target" ] || ! grep -q '^# Recall.md Docker launcher v1$' "$target"; then
    echo "Recusando sobrescrever comando existente: $target" >&2; exit 1
  fi
fi
image=${RECALL_IMAGE:-ghcr.io/gmrodrigues/recall.md:latest}
docker pull "$image" </dev/null
staging=$(mktemp "$bin_dir/.recall-install.XXXXXX")
trap 'rm -f "$staging"' EXIT HUP INT TERM
cat > "$staging" <<'LAUNCHER'
#!/bin/sh
# Recall.md Docker launcher v1
set -eu
image=${RECALL_IMAGE:-ghcr.io/gmrodrigues/recall.md:latest}
case ${1:-} in
  update)
    [ "$#" -eq 1 ] || { echo 'Uso: recall.md update (RECALL_IMAGE seleciona outra imagem).' >&2; exit 1; }
    exec docker pull "$image"
    ;;
  --help|-h)
    echo 'recall.md: CLI, TUI e web via Docker.'
    echo 'recall.md update: baixa a imagem atualizada sem alterar seus dados.'
    ;;
esac
project_dir=$(pwd -P)
# Keep the host path inside the container: relative and absolute project paths work.
command_name=
value_pending=false
for arg in "$@"; do
  if [ "$value_pending" = true ]; then value_pending=false; continue; fi
  case "$arg" in
    --cwd|--title|--description|--deck|--file|--status|--id|--answers|--question|--correct|--card|--rating|--port|--host) value_pending=true ;;
    --*=*|--json|--due|--help|-h) ;;
    -*) ;;
    *) command_name=$arg; break ;;
  esac
done
if [ "$command_name" = browser ]; then
  port=6421
  expect_port=false
  for arg in "$@"; do
    if [ "$expect_port" = true ]; then port=$arg; expect_port=false; continue; fi
    case "$arg" in --port) expect_port=true ;; --port=*) port=${arg#--port=} ;; esac
  done
  case "$port" in ''|*[!0-9]*) echo 'Porta inválida (1–65535).' >&2; exit 1 ;; esac
  [ "$expect_port" = false ] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ] || { echo 'Porta inválida (1–65535).' >&2; exit 1; }
  set -- --publish "127.0.0.1:$port:$port" "$image" "$@" --host 0.0.0.0
else
  set -- "$image" "$@"
fi
if [ -t 0 ] && [ -t 1 ]; then set -- --tty "$@"; fi
container_user="$(id -u):$(id -g)"
security_options=$(docker info --format '{{json .SecurityOptions}}' </dev/null)
case "$security_options" in
  *'"name=rootless"'*) container_user=0:0 ;;
esac
exec docker run --rm --interactive --user "$container_user" \
  --mount "type=bind,source=$project_dir,target=$project_dir" \
  --workdir "$project_dir" "$@"
LAUNCHER
chmod 755 "$staging"
mv -f "$staging" "$target"
echo "Instalado: $target"
echo 'Use recall.md init, recall.md tui ou recall.md browser na pasta de estudo.'
case :${PATH:-}: in *:"$bin_dir":*) ;; *) printf 'Adicione ao PATH do seu shell: export PATH="%s:$PATH"\n' "$bin_dir" ;; esac
