---
name: devland-preview
description: Abre a prévia ao vivo do site no DevLand (o escritório onde a pessoa acompanha você), já na porta certa. Use quando a pessoa pedir para "abrir o preview", "ver o site", "mostrar como ficou" ou quando você subir um servidor de desenvolvimento (npm run dev, vite, next dev...) e quiser mostrar o resultado.
---

# Prévia ao vivo no DevLand

A pessoa acompanha você pelo DevLand, que tem uma janela de **prévia ao vivo**: ela mostra o site que roda numa porta
desta máquina e recarrega sozinha quando você edita um arquivo. Você não precisa de navegador: basta pedir ao DevLand
para abrir a prévia na porta do servidor de desenvolvimento.

## Como abrir

1. Na pasta do projeto, peça ao DevLand para abrir a prévia. Ele instala as dependências se faltarem (`npm install`),
   sobe o servidor de desenvolvimento e abre a prévia ao lado da conversa quando a porta aparecer. Pode levar alguns
   minutos na primeira vez; você não precisa subir o servidor nem usar navegador:

```bash
curl -s -X POST "http://127.0.0.1:${HABBLAUD_PORT:-4747}/api/preview/open" \
  -H 'Content-Type: application/json' -d "{\"folder\":\"$PWD\"}"
```

2. Se o projeto já roda por conta própria (você subiu o servidor), passe a porta: `-d '{"port": 5173}'`.

Resposta `{"ok":true,...}`: o DevLand já está cuidando e a prévia abre sozinha. Avise a pessoa em uma frase.

## Observações

- Porta de 1024 a 65535 e diferente da do DevLand (4747/4748).
- Página que exige login ou banco de dados mostra o mesmo que o navegador mostraria: se precisar, diga o que falta.
- Se o `curl` falhar (DevLand fora do ar, porta recusada), diga a porta para a pessoa abrir em "Prévia ao vivo".
