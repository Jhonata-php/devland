#!/bin/sh
# Habblaud Cloud (Dockerfile.cloud): acerta os donos dos volumes antes de subir o servidor. Volume novo nasce com
# dono root; /workspace e /home/dev são do usuário dos agentes, /data só do servidor.
set -eu
chown dev:dev /workspace /home/dev
mkdir -p /home/dev/.claude /home/dev/.codex /home/dev/.habblaud/usage
chown dev:dev /home/dev/.claude /home/dev/.codex /home/dev/.habblaud /home/dev/.habblaud/usage
chown root:root /data
chmod 700 /data
exec "$@"
