#!/bin/sh
# DevLand Cloud (Dockerfile.cloud): acerta os donos dos volumes antes de subir o servidor. Volume novo nasce com
# dono root; /workspace e /home/dev são do usuário dos agentes, /data só do servidor.
set -eu
chown dev:dev /workspace /home/dev
mkdir -p /home/dev/.claude/projects /home/dev/.codex /home/dev/.devland/usage
chown dev:dev /home/dev/.claude /home/dev/.claude/projects /home/dev/.codex /home/dev/.devland /home/dev/.devland/usage
chown root:root /data
chmod 700 /data

# Atualização nativa (server/updates/self-update.ts): se há uma versão baixada em /data/app/current, roda o código dela em vez
# do da imagem. Só vale se for mais nova que a imagem e usar as mesmas dependências (deps.hash). Se a versão anterior não
# chegou a ficar de pé (o marcador "booting" fica até o servidor passar 60 s no ar), ela é marcada como ruim e volta o código
# da imagem. Qualquer dúvida cai no `exec "$@"` do fim: o container nunca deixa de subir por causa disso.
APPDIR=/data/app
if [ -f "$APPDIR/booting" ]; then
  badv=$(cat "$APPDIR/booting" 2>/dev/null || true)
  [ -n "$badv" ] && touch "$APPDIR/bad-$badv"
  rm -f "$APPDIR/booting" "$APPDIR/current"
fi
if [ -f "$APPDIR/current" ]; then
  v=$(cat "$APPDIR/current" 2>/dev/null || true)
  case "$v" in ""|*[!0-9A-Za-z.-]*) v="" ;; esac
  imgv=${DEVLAND_CLOUD_VERSION#cloud-v}
  if [ -n "$v" ] && [ -f "$APPDIR/$v/dist/server/index.js" ] && [ ! -f "$APPDIR/bad-$v" ] \
     && [ "$v" != "$imgv" ] && [ "$(printf '%s\n%s\n' "$v" "$imgv" | sort -V | tail -n 1)" = "$v" ] \
     && [ -f /app/deps.hash ] && cmp -s /app/deps.hash "$APPDIR/$v/deps.hash"; then
    ln -sfn /app/node_modules "$APPDIR/$v/node_modules"
    echo "$v" > "$APPDIR/booting"
    export DEVLAND_CLOUD_VERSION="cloud-v$v"
    cd "$APPDIR/$v"
    exec "$@"
  fi
fi
exec "$@"
