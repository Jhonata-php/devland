# Habblaud Cloud — Etapa 1 (login multiusuário em Docker)

> Spec: `docs/superpowers/specs/2026-11-06-habblaud-cloud-design.md`. Execução inline, um commit no fim da etapa.

**Goal:** `HABBLAUD_CLOUD=1` transforma a porta 4748 num login multiusuário (admin criado com código de instalação,
convites, papéis, permissões por usuário), pronto para ficar atrás do Traefik do Velix.

**Architecture:** reaproveita `server/http/remote.ts` (gate, cookie HMAC, freio, scrypt). Sessões ganham um token `v2`
com o id do usuário e a época dele na chave. Usuários e convites ficam em `<dataDir>/users.json`. Rotas novas em
`server/http/cloud.ts`; páginas server-side no mesmo estilo da tela de login.

## Restrições

- Servidor sem dependências de runtime (só `node:*`).
- Todo texto visível por `tr('PT')`, traduções em `shared/locales/{en,es,fr}.ts`; mudança visível no `CHANGELOG.md`.
- A 4747 nunca é publicada no `docker-compose.cloud.yml`.
- O modo de um usuário só (`HABBLAUD_REMOTE_USER`) continua igual, com os testes atuais passando.

## Tarefas

1. **`server/cloud/users.ts` — UserStore** (+ `users.test.ts`): `isEmpty`, `create`, `verify` (scrypt sempre roda),
   `get`, `list`, `update(role/allow)`, `remove`, `bumpEpoch`, `createInvite` (devolve token; guarda SHA-256, 7 dias),
   `acceptInvite` (uso único). Gravação atômica, permissão 600.
2. **`server/http/remote.ts`**: `RemoteSessions` aceita `userKey(uid)` e emite/valida `v2.<uid>.<exp>.<sig>`;
   `renew` para a janela deslizante; `secure` pode ser função da requisição; gate com `cloud` opcional (login pelo
   UserStore, rotas públicas de setup/convite, `/setup` quando não há usuários); `remoteUserOf(req)`; `formPage`
   extraído do `loginPage`. Testes novos em `remote.test.ts`.
3. **`server/http/cloud.ts`**: páginas `/setup`, `/convite/<token>`, `/admin`; APIs `/api/cloud/setup`,
   `/api/cloud/invite`, `/api/cloud/me`, `/api/cloud/users[/<id>]`, `/api/cloud/invites`, `/api/cloud/logout-all`.
   Admin-only onde couber. Testes HTTP.
4. **Permissões por usuário**: `config.ts` (`HABBLAUD_CLOUD`), `index.ts` e `app.ts` (`allows(req, feature)`), Hub
   `canAnswer`, `AccessInfo.admin` + link "Usuários" nas configurações do cliente.
5. **Docker**: `docker-compose.cloud.yml` (só 4748; `HABBLAUD_CLOUD=1`, `HABBLAUD_ALLOWED_HOSTS`), README pt-BR,
   CHANGELOG, traduções.
6. **Verificação**: `npm test`, `npm run typecheck`, `npm run i18n:check`; subir o compose local e testar no navegador
   (código no log → admin → convite → login do convidado → permissões). Commit.
