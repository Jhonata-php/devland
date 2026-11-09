---
name: devland-preview
description: Abre a prévia ao vivo do site no DevLand (o escritório onde a pessoa acompanha você), já na porta certa. Use quando a pessoa pedir para "abrir o preview", "ver o site", "mostrar como ficou" ou quando você subir um servidor de desenvolvimento (npm run dev, vite, next dev...) e quiser mostrar o resultado.
---

# Prévia ao vivo no DevLand

A pessoa acompanha você pelo DevLand, que tem uma janela de **prévia ao vivo**: ela mostra o site que roda numa porta
desta máquina e recarrega sozinha quando você edita um arquivo. Você não precisa de navegador: basta pedir ao DevLand
para abrir a prévia na porta do servidor de desenvolvimento.

## Como abrir

1. Garanta que o servidor de desenvolvimento do projeto está rodando (em segundo plano, para não travar a sessão) e
   descubra a porta (a saída do `npm run dev`, do vite, do next etc. mostra; ex.: 3000, 5173, 3220).
2. Peça ao DevLand para abrir a prévia nessa porta:

```bash
curl -s -X POST "http://127.0.0.1:${HABBLAUD_PORT:-4747}/api/preview/open" \
  -H 'Content-Type: application/json' -d '{"port": 5173}'
```

Resposta `{"ok":true,...}`: a prévia abriu no DevLand de quem está olhando. Avise a pessoa em uma frase ("abri a prévia
na porta 5173").

## Observações

- Porta de 1024 a 65535 e diferente da do DevLand (4747/4748).
- Página que exige login ou banco de dados mostra o mesmo que o navegador mostraria: se precisar, diga o que falta.
- Se o `curl` falhar (DevLand fora do ar, porta recusada), diga a porta para a pessoa abrir em "Prévia ao vivo".
