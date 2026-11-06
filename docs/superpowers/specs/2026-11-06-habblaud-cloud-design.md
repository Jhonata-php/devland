# Habblaud Cloud — Design

**Status:** etapa 1 aprovada; etapas 2–5 com direção definida, cada uma terá seu próprio detalhamento antes do código.

## Objetivo

Transformar o Habblaud num app multiusuário instalável pela loja do Velix. Uma instância por instalação, isolada; domínio
e HTTPS pelo Traefik do Velix (ex.: `habblaud.needbr.com`, um domínio comum do Velix, sem curinga). **A porta 4747 (sem login) nunca é publicada.**

## Decisões

- **Escritório compartilhado:** todos os usuários da instância veem todos os agentes. O que cada um pode *fazer* é
  configurável por usuário (lista `allow`).
- **Login próprio** estendendo a porta remota que já existe (`server/http/remote.ts`, porta 4748), em vez de proxy de
  autenticação externo.

## Etapa 1 — Docker + login multiusuário

### Usuários (`<dataDir>/users.json`, permissão 600)

`{ id, name, passwordHash (scrypt, remote/password.ts), role: 'admin'|'user', allow: RemoteFeature[], sessionEpoch }`.
Admin tem todas as features. `allow` usa as features que já existem: `permissions`, `messages`, `terminal`, `spawn`.

### Primeiro acesso

Sem usuários, a página mostra "Criar admin", que exige o **código de instalação**: aleatório, gerado na subida,
impresso no log do container (visível em `container_logs` do Velix), descartado após o uso. Sem o código, ninguém vira
admin por chegar primeiro.

### Convites

Admin gera `/convite/<token>` com papel e `allow`. Token aleatório de 32 bytes, uso único, validade de 7 dias; o
arquivo guarda só o SHA-256 do token. Quem abre escolhe nome e senha.

### Sessão

O cookie atual (`habblaud_remote`, HMAC, HttpOnly, SameSite=Strict) passa a carregar o `userId`; a chave por usuário
inclui `sessionEpoch`, então trocar senha, remover o usuário ou "sair de todos os aparelhos" invalida as sessões dele.
A lista de tokens encerrados continua igual.

### Permissões por usuário

`AppDeps.remote.allows(feature)` vira `allows(req, feature)`, lendo o `allow` do usuário da requisição. Rotas de
administração (`/api/users/*`, `/api/invites/*`) exigem `role === 'admin'`.

### Modo nuvem

`HABBLAUD_CLOUD=1` liga o login multiusuário (ignora `HABBLAUD_REMOTE_USER`/`_PASSWORD_HASH`), aceita HTTP na 4748 e
confia em `X-Forwarded-Proto` para o `Secure` do cookie (o TLS termina no Traefik). `docker-compose.cloud.yml` publica
**só** a 4748; a 4747 fica sem `ports:`.

### Interface

Telas de "Criar admin", login e aceitar convite no estilo da tela de login atual; painel "Usuários" para o admin
(listar, convidar, mudar papel/permissões, remover). Todo texto por `tr()` com as traduções em `shared/locales`.

### Testes

Vitest: criação do admin com e sem código, convite (uso único, expiração), login, `allows` por usuário, rotas de
admin negadas a usuário comum, invalidação por `sessionEpoch`. Depois, Docker local + navegador.

### Pronto

Etapa 1 rodando em Docker local com `docker-compose.cloud.yml`, testada no navegador: criar admin com o código,
convidar um usuário, entrar com ele e ver que as permissões valem.

## Etapas seguintes (direção)

2. **GitHub pela web:** device flow por usuário; token guardado cifrado em `/data`; clonar projetos no servidor.
3. **Claude Code e Codex pela web:** terminal guiado para `claude /login` e `codex login`, com pasta de config por
   usuário; `HABBLAUD_PTY` só atrás do login.
4. **Catálogo do Velix:** manifesto em `velix/apps/api/src/catalog/manifests/habblaud.ts` (formato `VelixManifest`),
   `primaryPort: 4748`, só a 4748 em `ports`, volume `data` em `/data`.
5. **Prévia do app ao lado do terminal:** painel web com endereço, recarregar, abrir em nova aba e tamanhos de tela.
   A prévia passa sempre pelo login do Habblaud. Forma de acesso a decidir: caminho `habblaud.needbr.com/preview/5173/` (funciona hoje) ou subdomínio
   `5173.habblaud.needbr.com` (exige rota e certificado curinga no Traefik do Velix, que já usa DNS-01 da Cloudflare).

## Sessões que não caem (requisito de todas as etapas)

- **Login:** cookie de 30 dias renovado a cada uso (janela deslizante); só cai por "Sair", troca de senha ou remoção.
  Entra na etapa 1.
- **Agentes:** rodam no servidor, nunca no navegador. Fechar a aba, trocar de rede ou o celular dormir não encerra
  nada; ao voltar, o terminal reconecta e reapresenta a tela (o `pty/manager.ts` já mantém o processo vivo sem
  ninguém olhando). Entra na etapa 3.
- **Reinício do container** (redeploy, auto-heal do Velix): os agentes que estavam abertos voltam sozinhos com
  `claude --resume <sessão>` / `codex resume <sessão>`, a lista guardada em `/data`. Entra na etapa 3.

## Fora do escopo

Isolamento de agentes por usuário dentro da mesma instância; SSO externo.
