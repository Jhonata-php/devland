# Novidades

O que entrou em cada versão do Habblaud. Cada versão tem a sua seção aqui, e o texto dela vira as notas da
[release no GitHub](https://github.com/marmottajr/habblaud/releases) (`npm run release`), que o Habblaud abre em
**Configurações › Sobre › Ver o que mudou**.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), e os números seguem o
[versionamento semântico](https://semver.org/lang/pt-BR/): correção sobe o último número (0.2.**1**), novidade sobe o
do meio (0.**3**.0).

## [Não lançado]

### Adicionado

- **Novo agente sem anexos no Cloud:** corrigido o erro "não deu para gravar os anexos (ENOENT ... chown)" que aparecia ao começar um agente sem anexar nada.
- **Sem páginas soltas: Contas e Usuários viram janelas do app.** O `/contas` e o `/admin` deixaram de ser páginas à parte (sem as abas Escritório/Contas/Usuários/Configurações): abrem em janelas dentro do escritório, por Configurações (Contas conectadas e Usuários) ou pela barra de baixo. Os endereços antigos redirecionam para o app e abrem a janela certa.
- **Páginas de administração no visual DevLand:** Escritório, Contas, Usuários e Configurações (`/admin`, `/contas`) agora são verde neon sobre preto, como o login e o escritório, e cabem no celular (as abas rolam de lado em vez de estourar a página).
- **Topo sem faixa borrada:** a barra do topo no computador não tem mais fundo nem blur, que cobriam o começo da lateral. O botão "+ Contas" saiu do topo: fica em Configurações › Contas conectadas.
- **Plugins no Cloud novo:** corrigido o erro "Plugin not found in marketplace" que aparecia numa instalação limpa (o servidor deixou de achar a própria pasta depois que o pacote virou `devland`). O prefixo do log agora é `[devland]` e o certificado local do celular se chama "DevLand local CA".
- **Nome DevLand em todo lugar:** textos da tela, notificações, ajuda, mensagens do servidor e dos plugins, manuais e nome do pacote passam a dizer DevLand. O "Habblaud World", as variáveis `HABBLAUD_*`, as pastas em `~/.habblaud` e o nome da imagem no GitHub continuam como estavam, para não quebrar instalações existentes.
- **Salas de projeto com visual DevLand:** piso de tapete escuro (grafite, azul-noite, vinho...) e paredes escuras com um neon diferente por sala (verde, roxo, ciano, âmbar, rosa...); mesas e cadeiras escuras. As decorações de Natal/Halloween agora vêm desligadas por padrão (dá para ligar em Ajustes › Aparência).
- **Mapa sem rua nem carros:** no lugar da rua há um passeio de jardim com trilha de pedra, canteiros floridos, bancos e postes.
- **Mapa no tema DevLand:** os rótulos das salas e dos agentes no mapa usam fonte de terminal, fundo preto e borda verde (o agente selecionado fica verde); vinheta escura nas bordas para destacar as salas; no celular em pé a visão geral aproxima 25% para as salas ficarem legíveis.
- **Botão da lateral como o do WCAM:** uma bolinha com seta presa na borda do trilho/painel (abre e fecha), em vez de um quadrado; o logo na lateral agora é só o planeta, sem fundo nem quadrado em volta (o ícone do app e a aba continuam com o fundo escuro).
- **Marca em duas cores:** `DEV` em verde-neon e `LAND` em branco, com o logo do planeta um pouco maior.
- **Marca integrada à lateral (computador):** recolhida, a lateral vira um trilho fino com o logo, um botão pequeno para expandir e, embaixo, os anéis de uso das contas; aberta, o mesmo bloco vira o cabeçalho da lista de salas (logo + nome + botão de recolher) e os anéis vão para o canto direito. A barra de atividade começa depois do trilho.
- **Computador: tudo flutuante e mínimo.** O topo perde a barra: ficam o logo no canto esquerdo e uma cápsula de ícones (sem textos) no canto direito, mais a ficha de quem precisa de você. O uso vira anéis flutuantes com a letra da conta na borda direita, embaixo dos ícones (saem da frente quando a gaveta do agente abre) (sem texto nem porcentagem); ao passar o mouse abre a dica com nome, plano, números e reinício.
- **Contas como mostradores circulares:** cada conta é uma cápsula com anel duplo (fora = sessão de 5 h, dentro = semana; verde, âmbar ou vermelho conforme o uso), a letra no centro, o nome e uma linha `5H 41% · SEM 21%` (o reinício e o e-mail ficam na dica). As ferramentas do topo ficam em duas cápsulas (câmera e painéis).
- **Topo com ferramentas legendadas:** ícones verdes com o nome embaixo (Visão, Menos, Mais, Novo, Feed, Ajustes, Ajuda), estado ligado em destaque e brilho; no celular ficam só os ícones. O favicon agora é só o planeta com o anel azul, sem fundo.
- **Logo do DevLand:** planeta em pixel art (oceanos, continentes, luz de um lado) com anel orbital, lua e estrelas, no topo, no login, no ícone do app e na aba (`scripts/brand-logo.py` gera os PNGs).
- **Nova marca "DevLand"** no logotipo (texto `DEVLAND_` em terminal), no título da aba, no app da Tela de Início e nas telas de entrada (`shared/brand.ts` é o único lugar para trocar). O Habblaud World e o código interno mantêm o nome original.
- **Botões, avisos, atividade e janela de Contas no tema hacker:** botões de terminal em caixa-alta que enchem de verde; avisos como cartões de log com etiqueta do nível (`alerta`, `ok`, `aviso`, `info`) e brilho na cor dele; atividade em linhas de log `[hora]`; Contas com barra de terminal.
- **Agentes por função:** cada agente principal tem uma função (front-end, back-end, testes, DevOps, revisão, design),
  escolhida em **Novo agente** (campo Função) ou deduzida dos arquivos que ele mexe e do nome do projeto. A função
  aparece como ficha neon (ícone e cor próprios) no personagem do mapa, na lateral, no cartão do agente e nas
  Conversas, e a lateral filtra por função.
- **Prévia ao vivo do site:** o botão de navegador na barra do topo abre uma janela com o site do projeto (detecta
  servidores de desenvolvimento nas portas comuns ou você digita a porta), recarrega sozinha quando um agente altera um
  arquivo e tem modo "celular". Passa por um proxy autenticado do servidor (só `127.0.0.1`, só leitura, mesma trava do
  terminal, endereço com token que expira, iframe em sandbox e sem repassar cookies); no Cloud exige a permissão
  "terminal". Funciona melhor com sites estáticos, renderizados no servidor e Vite; formulários com POST e o
  WebSocket do HMR não passam.

- **Sons diferentes por tipo de aviso:** alarme (precisa de você), arpejo (concluiu), grave (aviso) e pingo
  (informação); em Ajustes › Sons há botões para ouvir cada um.
- **Layout hacker:** topo em três zonas (marca | métricas num bloco só com número grande e divisórias | contas em etiquetas compactas com faixa colorida e ferramentas soltas), com linha de varredura; lateral como árvore de
  arquivos (`~/escritório`, `/sala`, `├─ agente`); cada grupo dos ajustes é uma janela de terminal e os interruptores
  viram `ON`/`OFF`.
- **Tema hacker em toda a interface:** verde-neon sobre preto (o mapa do escritório mantém as cores originais), fonte monoespaçada, títulos com `>` e rótulos com `$`,
  bordas com brilho, botão principal em verde e varredura de monitor antigo. Combina com a tela de login.
- **Habblaud Cloud: login por e-mail.** Criar o admin e aceitar convite pedem e-mail; o login aceita e-mail ou usuário
  (contas antigas continuam entrando pelo usuário e definem o e-mail em Ajustes › Perfil). O e-mail é único e aparece na
  lista de usuários. As telas de criar admin e convite usam a mesma moldura hacker do login.
- **Tela de login no estilo "terminal hacker":** chuva de código ao fundo, terminal que digita os agentes, cartão com
  barra de janela, agentes em pixel art andando embaixo, olho para ver a senha e erro que balança. No celular o cartão
  vira uma folha até a borda de baixo. A moldura (`server/http/auth-shell.ts`) serve também às próximas telas.
- **Habblaud Cloud: uso de toda conta conectada, mesmo sem sessão aberta.** A cada 3 min o servidor consulta o uso
  com o login da conta (somente leitura; token vencido fica sem números até uma sessão renová-lo).
- **Habblaud Cloud: escolher a conta no "Novo agente"** ("Automática" usa a de mais folga) e **anexar fotos e arquivos
  nas Conversas**, mais um microfone que dita pelo navegador (iPhone/Chrome) quando o servidor não tem Whisper.
  Os anexos agora são gravados na casa do usuário dos agentes, para o Claude conseguir ler.
- **Habblaud Cloud: vários usuários com login.** Com `HABBLAUD_CLOUD=1` (ou `docker-compose.cloud.yml`), a porta 4748
  vira um login para várias pessoas, pronto para ficar atrás de um proxy com HTTPS. O primeiro acesso cria o admin
  com o código de instalação que sai no log; depois, convites com papel (admin ou usuário) e permissões por pessoa, em
  **Configurações › Usuários**. Todos veem o mesmo escritório. A 4747, sem login, não é publicada.
- **O login não cai enquanto você usa.** A sessão da porta com login (celular e Cloud) se renova sozinha a cada dia
  de uso, em vez de vencer 30 dias depois de entrar.
- **Habblaud Cloud: o container é a máquina de desenvolvimento.** A imagem do Cloud (`Dockerfile.cloud`) traz `git`,
  o Claude Code e o Codex; o terminal interativo e o Novo agente funcionam pelo navegador, com login, para quem tem a
  permissão de terminal. Os agentes rodam com um usuário do Linux separado, sem acesso aos dados de login.
- **Habblaud Cloud: conectar contas pela web.** Em **+ Contas**, o admin conecta contas do Claude, do Codex e do
  GitHub sem abrir terminal: a página mostra o link de login (e o código, quando há). Com o GitHub conectado, dá para
  clonar os repositórios em `/workspace` e os agentes fazem `git push` com essa conta. No topo, as contas sem dados de
  uso dão lugar ao botão **+ Contas**; com o escritório vazio, **Abrir terminal** começa o primeiro agente.

- **Habblaud Cloud: páginas Contas e Usuários com abas.** Escritório, Contas, Usuários e Configurações ficam numa barra
  de abas (Configurações abre o painel no escritório). Em Contas, cada serviço virou um cartão com o estado
  (Conectado / Não conectado), o Claude ganhou "Adicionar outra conta", o código do Codex e do GitHub tem botão
  Copiar e a mensagem velha de "Conta conectada." não fica mais sobrando embaixo do botão.

- **Habblaud Cloud: Novo agente em pasta clonada funciona direto.** A pasta escolhida já entra como confiável para o
  Claude Code (antes dava "a pasta ainda não é confiável" e tentava abrir o app, que não existe no servidor), e os
  projetos clonados em `/workspace` aparecem como escolhas na lista de pastas. Em Contas, os repositórios do GitHub
  viraram cartões com busca.

- **Habblaud Cloud: Contas abre numa janela dentro do escritório.** **+ Contas** e **Conectar contas** mostram a mesma
  página como um modal, sem trocar de aba; Ctrl/Cmd+clique ainda abre a página inteira.

- **Habblaud Cloud: celular e terminal de agente sem conversa.** Contas e Usuários se ajustam à tela do celular (a
  janela de Contas ocupa a tela toda). Abrir o terminal de um agente que ainda não tem conversa gravada agora explica o
  motivo (antes dizia que só funcionava no acesso local) e o servidor registra no log.

- **Notificação do navegador quando o agente termina.** Com **Configurações › Notificações do navegador** ligado, a aba
  em segundo plano agora também avisa "concluiu" (e o fim de tarefas em segundo plano), além do "precisa de você".

- **Celular: terminal e barra de uso sem sobreposição.** No terminal de um agente, o cabeçalho passa a ter duas linhas
  ("Assumir daqui" e "Encerrar" ocupam a de baixo, em vez de espremer o nome), o botão de copiar fica só com o ícone numa
  coluna própria (antes cobria o texto) e os cartões de uso do topo não encolhem mais por cima uns dos outros.

- **Habblaud Cloud: atualizar por dentro do app.** O Habblaud agora sabe a versão da imagem em uso e confere as tags
  novas no GHCR: aparece o selo "Nova versão" e, em **Configurações › Sobre**, o botão **Atualizar agora** (só admin)
  pede ao Velix para reimplantar, e a página recarrega quando o app volta. Para o botão aparecer, crie um token de API do
  Velix (Configurações › Assistentes de IA, escopo escrita) e defina no projeto `HABBLAUD_VELIX_URL`
  (ex.: `https://velix.suaempresa.com`), `HABBLAUD_VELIX_TOKEN` e `HABBLAUD_VELIX_PROJECT` (id, slug ou nome). Sem elas,
  só avisa.
- **Celular: barra lateral em tela cheia.** No celular a barra lateral usa a largura toda (sobrava uma faixa do mapa
  ao lado) e o "+ Contas" ficou menor para a barra do topo caber melhor.
- **Terminal de agente recém-criado abre sozinho.** Um agente novo ainda não tem conversa gravada; o terminal tenta de
  novo a cada 2 s por até 30 s em vez de pedir para clicar em "Tentar de novo".

- **Celular: barra de navegação embaixo.** Até 600 px de largura, uma barra fixa na parte de baixo leva ao
  **Escritório** (volta ao mapa), **Agentes** (painel lateral, com o número de quem precisa de você), **Novo** agente e
  **Ajustes**. O painel lateral, a gaveta do agente, o feed e os avisos sobem acima dela.

- **Habblaud Cloud: aba Contas e perfil.** No celular, a barra de baixo ganha a aba **Contas** (no lugar do "+ Contas" do
  topo), e **Configurações** mostra o **Perfil** (quem está logado) e o atalho **Contas conectadas**.

- **Contas no celular como folha de baixo.** A janela de Contas sobe de baixo com largura total, alça e cantos
  arredondados; cada serviço é um cartão com ícone, nome e estado (verde quando conectado).

- **Habblaud Cloud: uso das contas.** O servidor instala sozinho o captador de uso no Claude Code de cada conta (ao subir
  e ao conectar uma conta nova), para os cartões de 5 h e semana aparecerem depois da primeira sessão interativa.

- **Habblaud Cloud: mensagens e permissões pelo escritório.** O servidor instala sozinho, em cada conta do Claude Code, os
  plugins `habblaud-mensagens` e `habblaud-permissoes` (ao subir e ao conectar uma conta), então "Mandar mensagem" e responder
  pedidos de permissão funcionam nas sessões novas. O terminal de agente ganhou o botão **Nova sessão**, e no celular o topo
  não repete o que a barra de baixo já tem.

- **Habblaud Cloud: ligar ao Velix pela tela de Ajustes.** Em **Ajustes › Sobre**, o admin cola o endereço do Velix, um
  token de API e o projeto (o servidor guarda em `<dados>/velix.json`, e o token nunca volta para a página); com isso o
  botão **Atualizar agora** aparece quando sai versão nova, sem editar variáveis do Velix. No Cloud, as instruções de
  `git pull` deixam de aparecer.
- **Ajustes no celular redesenhados.** O menu vira uma folha cheia (acima da barra de baixo, com rolagem por dentro),
  com seções em cartões, cabeçalho fixo, fundo sólido e linhas maiores para tocar.

- **Habblaud Cloud: os agentes voltam depois de reimplantar.** O servidor guarda quem estava ativo (conta, sessão e pasta) e,
  ao subir, retoma cada conversa com `claude --resume` (até 6), em vez de os personagens sumirem e você ter de criar
  agentes novos. Quem foi encerrado de propósito não volta.

- **Habblaud Cloud: atualizar sozinho.** Em **Ajustes › Sobre** o admin liga "Atualizar sozinho quando sair versão nova" e
  escolhe a janela: de madrugada (2h às 5h, no fuso dele) ou a qualquer hora. O Habblaud confere as versões a cada hora e,
  dentro da janela, pede ao Velix para reimplantar (uma vez por tentativa, com pausa de 1 h se falhar). Depende da conexão com
  o Velix já configurada ali; as conversas abertas voltam sozinhas depois do reinício.

- **Celular: o que cada agente faz aparece no mapa.** Na primeira visita em tela de celular, os balões de atividade vêm em
  "Todos" (antes só as atividades importantes), porque os personagens são pequenos. Quem já tinha preferências guardadas
  mantém as suas (Ajustes › Escritório › Balões de atividade).

- **Habblaud Cloud: atualização nativa, sem Velix.** O workflow publica o código de cada versão como um pacote público no GHCR
  (`dist-cloud-v…`); o botão **Atualizar** (e o "atualizar sozinho") baixa esse pacote, confere o sha256 e as dependências,
  guarda em `/data/app` e reinicia: o container passa a rodar o código novo, e volta sozinho à imagem se ele não ficar de pé
  em 1 minuto. Se a versão muda as dependências, o app avisa que precisa de imagem nova (aí vale o Velix, pelo formulário que
  aparece em Ajustes › Sobre).
- **Terminal do agente: a conversa aparece mesmo quando o fim do arquivo é só uma linha enorme** (a leitura inicial amplia a
  janela até achar mensagens), e no celular o campo de mensagem usa o texto curto.

- **Conversas: os agentes como num app de mensagens.** A aba **Conversas** da barra de baixo (celular; no computador abre ao lado)
  lista os agentes como conversas (foto, projeto, o que estão fazendo, quando) e, ao tocar, abre o histórico em balões: o que
  você pediu à direita, a resposta do agente à esquerda (com formatação), avisos no meio e as ferramentas em linhas discretas,
  com a caixa de resposta embaixo. Sem abrir gaveta nem terminal.

- **Habblaud Cloud: o escritório abre funcionando.** Se ao subir não houver agente para retomar, o servidor abre sozinho um
  primeiro agente em `/workspace` (com uma conta do Claude conectada), em vez de mostrar "O escritório está vazio" e pedir para
  clicar em Abrir terminal. `HABBLAUD_AUTO_AGENT=0` desliga.

- **Celular: o terminal interativo do Claude ocupa a tela toda.** Ele ficava por baixo da barra do topo (o cabeçalho sumia);
  agora cobre as barras, como o terminal da conversa.

- **Habblaud Cloud: conversas novas vão para a conta com mais folga.** Novo, Nova sessão e o primeiro agente escolhem sozinhos a
  conta conectada com menos uso (a pior entre 5 h e semana); uma conversa em andamento fica na conta dela. O mod de uso também é
  instalado em cada conta, para o uso ao vivo se atualizar a cada turno, e os agentes só são reabertos depois de os plugins
  estarem instalados (antes, o plugin de mensagens podia não carregar). O aviso de mensagens ficou claro no Cloud, sem `npm run`.

- **Cloud: a segunda conta do Claude aparece no topo.** Uma conta conectada aparecia só depois de ter números de uso; agora
  todas as contas do Claude conectadas têm o seu cartão, e os números chegam quando uma conversa dela trabalha.

- **Notificações push de verdade (iPhone e computador).** Em **Ajustes › Avisos**, ligar "Notificações do navegador" assina o
  aparelho no push do servidor (chaves VAPID e criptografia RFC 8291, sem dependência nova): quando um agente termina ou
  precisa de você, o aviso chega mesmo com o Habblaud fechado. No iPhone é preciso adicionar o Habblaud à Tela de Início e abrir
  por lá (iOS 16.4 ou mais novo). Há um botão **Enviar teste**.

- **Habblaud Cloud: versão nova avisada pelo Velix.** A imagem do Cloud não consulta mais as releases do projeto
  original; a versão nova aparece no projeto do Velix ("Atualizar para ...").

### Corrigido

- **Fundo do trilho da lateral cortado (só atrás do logo):** o fundo virou um elemento próprio preso à tela, de cima a baixo, independente do painel do topo.
- **Marca cortada na lateral em janelas menores:** até ~1040 px de largura, regras antigas escondiam o nome ou o punham por cima do logo; agora o trilho recolhido mostra o logo, a bolinha e os anéis com fundo de cima a baixo, e aberto mostra o logo e `DEVLAND_` lado a lado em qualquer largura.
- **Bolinha da lateral recolhida espremida:** uma regra antiga a esticava para 48 px de altura; agora é redonda (26 px), entre o logo e os anéis de uso, que ganharam mais espaço.
- **Revisão visual:** avisos de alerta com fundo sólido (o texto de trás aparecia); no celular um aviso por vez e nenhum por cima da caixa de mensagem dentro de uma conversa; a função do agente nas Conversas virou etiqueta pequena (ocupava a largura toda); a barra de baixo acende Ajustes quando os ajustes estão abertos; a Prévia ao vivo não cobre mais o trilho da esquerda.
- **Atualização nativa não encontrava o pacote da versão nova (404):** a imagem principal era publicada antes do pacote `dist-`, e o servidor via a versão nova antes de o pacote existir. Agora o pacote sai primeiro.
- **Celular: topo mínimo.** Uma linha fina de 48 px com o logo, os mostradores de uso (só os anéis) e o aviso de quem precisa de você; as ferramentas ficam na barra de baixo e o mapa ganha a tela. Também corrige a primeira linha dos agentes na lateral, que sobrepunha o papel e a função.
- **Atualização automática checa as versões novas a cada 30 min** (antes, a cada 6 h; quem estava na frente de uma sequência de versões demorava a receber).
- **Estilos do seletor de conta no "Novo agente" e dos anexos da caixa de mensagem não eram carregados** (estavam num
  arquivo que nenhuma página importava); agora estão em `ui/styles.css`.
- **Habblaud Cloud, segurança:** o freio de tentativas de login agora é por cliente (quem erra a senha não trava mais o
  dono da conta; há um freio global folgado contra troca de endereço); toda resposta leva HSTS, Permissions-Policy,
  proteção contra ser embutido por outro site e COOP; o nome do repositório a clonar não aceita começar com "-" nem
  ter "..".
- **Habblaud Cloud: agentes retomados não criam mais sala "worktree" nem se duplicam.** A conversa que estava num
  worktree volta para a pasta do projeto, e a mesma conversa só é retomada uma vez.
- **Habblaud Cloud: "Ativar" numa conta sem uso abre as Contas** (antes abria a ajuda com comandos `npm` que não
  servem no Cloud).
- **Habblaud Cloud: "Ver demonstração" voltou a funcionar para o admin** (antes caía em "não liberado no acesso
  remoto").

## [1.0.3] - 2026-10-16

### Corrigido

- **Cidade: “Responder” e “Mostrar no escritório” nos avisos voltam ao escritório e abrem o pedido do agente.** Com
  a cidade aberta, o clique no aviso de um pedido ou pergunta (e na notificação do navegador, no chip de pedidos da
  barra e nas Entregas) não fazia nada visível: o agente era escolhido atrás da cidade. Agora a cidade fecha, a
  gaveta abre no agente e o cartão do pedido recebe o foco.

## [1.0.2] - 2026-10-16

### Corrigido

- **Cidade: entrar e curtir voltaram a funcionar depois de deixar a aba em segundo plano.** Depois de meio minuto com
  o Habblaud em outra aba ou janela, o personagem parava de mandar a posição ao Habblaud World: andava na tela, mas
  "Entrar" e curtir diziam para chegar mais perto da porta.

## [1.0.1] - 2026-10-16

### Corrigido

- **Cidade: as teclas voltaram a andar.** Na 1.0.0, com os popups de lançamento e a janela do Habblaud World na
  página, WASD, as setas e os atalhos do escritório paravam de responder mesmo com tudo fechado: um `<dialog>`
  fechado continua na página e era tomado por um modal aberto. Só os diálogos abertos contam agora.

## [1.0.0] - 2026-10-16

Por que 1.0: o escritório (salas, personagens, subagentes, uso por conta, terminal, timelapse, celular com login) está
estável há várias versões, e o Habblaud World chega inteiro: conta, personagem, prédio, cidade, visitas e o social
leve. Para atualizar: `git pull` e `npm run docker:up`.

### Habblaud World

A cidade online do Habblaud está no ar: cada Habblaud vira um prédio, aceso ao vivo enquanto os agentes trabalham, e
cada pessoa passeia pela cidade com um personagem. **Vem ligado por padrão**, apontando para `server.habblaud.com`;
**nada sai do computador até você criar a conta** e entrar, e `HABBLAUD_WORLD=0` desliga tudo (esconde até as
rotas). O acesso é liberado por lista de espera. O que pode sair e o que nunca sai está em
[`docs/world/privacidade.md`](docs/world/privacidade.md); o README tem a seção **Habblaud World** completa, nos quatro
idiomas.

- **Configurar e testar:** sem `HABBLAUD_WORLD_URL`, o servidor oficial (`https://server.habblaud.com`; o `npm run
  docker:up` e o log do servidor dizem "(padrão)"); definida, vale a definida (só `https://` ou `wss://`; recusada, o
  World fica desligado, com o motivo no log). `HABBLAUD_WORLD=0` desliga tudo, e `HABBLAUD_WORLD_DEV=1` aceita um
  servidor do mundo local sem TLS em `http://127.0.0.1:<porta>` (o `npm run dev` já aceita) ou, de dentro do Docker, em
  `http://host.docker.internal:<porta>`. O `docker-compose.yml` repassa as três variáveis e liga `host.docker.internal`
  ao host (`extra_hosts` com `host-gateway`, inofensivo no macOS), e o `npm run docker:up` termina dizendo se o World
  está ligado e para qual servidor. O build grava `dist/build.json` com o commit e se a cópia estava modificada (vai na
  primeira mensagem da conexão do prédio).
- **Janela própria:** o Habblaud World tem um botão só dele na barra do topo (o ícone de cidade, ao lado de
  Configurações; só aparece com o servidor do mundo configurado) e abre num modal só dele, fora das Configurações: o
  prédio em pixels, o estado da conta no cabeçalho e tudo o que segue num corpo rolável. O chip "no mundo" ao lado da
  versão, os popups de lançamento e o aviso "Enquanto você estava fora" abrem a mesma janela, na tela certa.
- **Conta:** na janela do Habblaud World. **Criar conta** (e-mail e senha de 12
  caracteres ou mais, o resumo do que sai e do que nunca sai do computador, a linha dos dados verdadeiros e o aceite
  obrigatório dos Termos de Uso e da Política de Privacidade; o desafio anti-robô é resolvido pelo próprio Habblaud) ou
  **Já tenho conta**; código de 6 dígitos com reenvio; **Esqueci a senha**; **Dispositivos** (até 3, com revogar) e
  sair. Na lista de espera, só o aviso, sem posição nem previsão, e o Habblaud aberto confere sozinho a cada 30 minutos
  se o acesso foi liberado. Tudo só pelo próprio computador: nunca pela porta do celular, e o que age pela conta só com
  o acesso local (a trava do terminal). O token do dispositivo fica em `~/.habblaud/world.json` (permissão 600; no
  Docker, no volume `/data`) e nunca vai ao navegador, ao snapshot, aos logs nem à URL.
- **Nome de jogador escolhido no cadastro (fica reservado na lista de espera):** o cadastro pede o nome de jogador
  (3 a 20 caracteres, único no mundo) junto com o e-mail e a senha, conferido na hora e, se já estiver em uso, com o
  aviso no próprio campo. Ele fica reservado para a conta enquanto espera na lista (a tela da espera mostra "Seu nome
  de jogador: X (reservado)") e vira o nome do personagem, que nasce com ele sem pedir o nome de novo (dá para trocar
  depois, uma vez a cada 30 dias); contas antigas, sem reserva, seguem escolhendo o nome ao criar o personagem.
  `docs/world/privacidade.md` passa a dizer que o servidor do mundo guarda, além do país, o IP do cadastro e o do
  último login com senha, para auditoria (só a administração vê; apagados com a conta; incluídos em "Baixar meus
  dados"), e nenhum outro.
- **Popups de lançamento:** três avisos em janela modal, por cima do escritório (e de Configurações). **Novidade:
  Habblaud World**, para quem ainda não tem conta, com o botão **Criar conta**: "Agora não" o traz de volta em 3 dias
  (no máximo 3 vezes), "Não mostrar de novo" encerra e, com a conta criada, ele não volta. **Você está na lista de
  espera**, logo depois do cadastro (ou ao abrir a página já na espera), uma vez por navegador. **Acesso liberado!**,
  quando chega a sua vez e o personagem ainda não existe, com **Criar personagem** levando direto à tela dele. Nenhum
  deles aparece pela porta do celular, no timelapse ou no modo demonstração.
- **Personagem:** nome de jogador, dica visual, o mesmo editor de aparência da gaveta do agente, 2 ou 3 traços de
  personalidade (os que não combinam ficam desabilitados) e uma frase de apresentação da lista; dá para criar ainda na
  lista de espera. Se a moderação trocar o nome, a seção pede um nome novo, que entra sem esperar os 30 dias.
- **Visibilidade do prédio:** ao vivo ou discreto, fechado a visitas, esconder o país, tokens (só em faixas), placar,
  compactações e **Avisar quando baterem na porta** (desligado por padrão).
- **Conta e dados** (nova tela da janela do Habblaud World): o interruptor **Avisar por e-mail antes de retirar
  meu prédio por inatividade**; **Baixar meus dados**, que salva `habblaud-world-dados.json` com o que o mundo guarda da
  conta (uma vez por dia); e **Excluir conta** em três etapas: o que some e quando (o prédio e o perfil na hora; a
  conta, os likes, os bloqueios, as denúncias feitas e os dispositivos do banco em 7 dias; dos backups, em até 30), a
  confirmação, que manda um código ao e-mail, e o código. Com a conta excluída (daqui ou de outro computador), a conexão
  do prédio fecha e o `world.json` some deste computador; a seção avisa que a conta foi excluída.
- **Seu prédio no mundo:** com o acesso liberado e o personagem criado, o cartão **Seu prédio** mostra se o prédio está
  conectado, reconectando, pausado ou fora do mundo (ou se ainda falta o personagem), quantos andares e agentes ele
  tem, quando saiu a última remessa e, se o mundo recusar uma remessa, o motivo. Quando o servidor do mundo para o
  prédio, o cartão diz por quê: **Atualize o Habblaud** (versão antiga), **Conectado em outro computador** (com
  **Trazer para este computador**), conta suspensa ou banida (com **Recorrer por e-mail**, que abre um e-mail para
  privacidade@habblaud.com com o id da conta no assunto) ou conta excluída. Um prédio marcado como **não verificado**
  mostra o selo e **Contestar por e-mail**, e o mundo em manutenção aparece como **Em manutenção** (o Habblaud tenta de
  novo sozinho, com espera). **Pausar** interrompe o envio na hora e apaga o prédio, guardando o lote; **Retomar**
  acende de novo. **Sair do mundo** (em dois cliques, com a diferença para a pausa ao lado) retira o prédio na hora e
  libera o lote; a conta e o personagem continuam, e **Voltar ao mundo** cria um prédio novo, em outro lote (sair em
  outro computador também vale aqui). **Ver o que foi enviado** abre o JSON exato da última remessa, com o horário, o
  tamanho em bytes, a resposta do mundo (com os bytes que ele contou) e um botão para copiar: é tudo o que saiu do
  computador. O tema escolhido em **Aparência › Tema do escritório** também vale para o prédio (e o tema guardado para o
  prédio vale para o escritório), e a barra do topo ganha o selo "🏙️ no mundo" / "⏸ pausado" / "⚠️ parado", que abre
  a seção (some na barra apertada e no celular).
- **O prédio sobe ao mundo:** com a conta liberada e o personagem criado, o Habblaud abre uma conexão (WebSocket) com o
  servidor do mundo e manda o prédio ao vivo: um andar por sala com alguém presente e, por agente, só um id aleatório,
  principal ou subagente, a ferramenta, o status, um nome sorteado e a aparência; mais o tema, as tarefas concluídas no
  dia em faixa, os tokens do prédio arredondados (desligável) e, se você ligar, as compactações. Os ids dos andares e
  dos agentes são aleatórios e trocam a cada 24 h (±6 h); caminhos, nomes de sala, títulos, atividades, modelo, branch,
  conta e nomes editados nunca saem. Manda ao mudar (no máximo uma vez a cada 5 s), reconecta sozinho com espera
  crescente (2 s a 60 s, também na manutenção do mundo) e para quando o servidor pede (conta suspensa, banida ou
  excluída, versão antiga, conectada em outro lugar). Agentes do modo demonstração nunca sobem. As tarefas e as
  compactações são contadas também com o prédio pausado ou sem conexão, e vão na remessa seguinte.
- **A cidade (botão Mundo):** com a cena disponível (`meta.world.scene.available`), o botão **Mundo** ao lado do
  Timelapse troca o escritório pela cidade do Habblaud World, em pixel art 3/4 no mesmo estilo: quarteirões de 6 lotes
  com calçada, meio-fio, postes, árvores, faixas de pedestres e a praça central com a fonte, os bancos e o totem; lotes
  vazios viram jardins (parque, lago, pomar, café). Cada prédio tem a altura dos projetos abertos (até 12 andares
  desenhados, com placa "+N" acima disso), janelas acesas na proporção dos agentes trabalhando e piscando em âmbar as de
  quem espera, o tema do dono (abóboras, teias e morcegos no Halloween; neve, luzes, festão e árvore no Natal), tudo
  apagado com a tabuleta "Fechado" quando o prédio está fora, cor e acabamento pela semente do lote e a placa com a
  bandeira, o nome do dono e os ❤️ likes. A fileira de baixo de cada quarteirão mostra a fachada com a vitrine e a
  porta; a de cima, com a porta virada para o norte, mostra o telhado com a marquise da entrada e os fundos. À noite os
  postes e as janelas acendem. Anda com setas/WASD (Shift corre) ou clicando (o A* do escritório); a câmera segue, com o
  zoom de sempre e afastando até ver uns 200 prédios; perto de uma porta aparece **Entrar (E)** (veja "Visitar um
  prédio", abaixo). Passar o mouse num prédio abre o cartão (dono, país, estado, andares até "24+", agentes trabalhando,
  esperando e à toa ou "modo discreto", likes, "no mundo desde"); clicar num jogador abre o perfil (personagem, país,
  traços, frase, prédio e likes recebidos). Os outros jogadores andam suaves, um pouco atrás, no ritmo em que as
  posições chegam (5 por segundo para os 20 mais perto, 2,5 para os outros), com o nome em cima; quem para em cima de um
  banco aparece sentado (você também), e ausente o seu personagem fica parado onde está. O minimapa no canto mostra os
  quarteirões em volta, mais acesos quanto mais prédios ligados, e leva a câmera até onde você clicar. Esc ou
  **Escritório** voltam, e reabrir a cidade volta exatamente onde você estava (o personagem, a câmera e o zoom, sem
  piscar); Configurações continua aberta na cidade, e o escritório para de desenhar enquanto isso. A cena é carregada só
  quando abre. **Pausado ou fora do mundo, seu prédio fica apagado, mas você pode andar pela cidade**: com a cena
  aberta, a conexão leva só a primeira mensagem, o sinal de vida e os comandos da cena, nunca o pacote do prédio, e
  fecha junto com a cena. Conta banida, suspensa ou excluída (ou o prédio parado por versão antiga ou por outro
  computador): o botão Mundo some; ele também só aparece pela página do próprio computador (nunca pela porta do celular
  nem sem o acesso só local).
- **A cidade pelo servidor local:** com a cena aberta, o Habblaud pede ao servidor do mundo o pedaço da cidade em volta
  do seu personagem (`view`) pela mesma conexão do prédio e repassa ao navegador por `GET /api/world/stream` (SSE: o
  estado inteiro ao abrir, depois cada mudança na ordem); fechada a cena, avisa (`view.off`) e nada mais desce. Prédios
  por chunk com revisão (um salto pede a área de novo), jogadores por perto, minimapa e a sua posição ficam só em
  memória. Os comandos do personagem (`POST /api/world/cmd`: andar, perfil, entrar e sair de um prédio e os do social
  leve) são conferidos campo a campo, no máximo 5 lotes por segundo e só o último passo de cada lote; no máximo 4 abas
  com a cidade. Só pelo próprio computador e só pela própria página (nunca por outro site). A geometria da cidade
  (lotes, quarteirões, portas, chunks e o que é caminhável) fica em `shared/world/city.ts`, a mesma do servidor do
  mundo. O seu personagem entra na rua na posição que o servidor do mundo validou (na calçada da sua porta ou na praça).
- **Visitar um prédio:** a até 2 tiles da porta de um prédio, **Entrar (E)** leva para dentro: o escritório do dono como
  ele vê o dele, com o tema dele, as salas com os nomes fictícios do dia ("Projeto Ipê", "Projeto Jade"...) e os agentes
  no status de agora (digitando, de mão levantada, de olho no terminal ou à toa, com a vida social simulada no seu
  navegador), mudando na hora a cada pacote do dono. Você entra pelo elevador com o seu personagem e o crachá de
  **visitante** e anda com o teclado ou clicando (sem sentar nas mesas). A faixa do topo diz de quem é o prédio, quantos
  andares e agentes e se está em modo discreto (salas vazias, com a luz acesa) ou apagado (pausado: tudo escuro); o
  painel ao lado lista as salas e os agentes (nome, papel, ferramenta e status; clicar abre um cartão com isso e nada
  mais). Nada do que vem do mundo tem horário, então lá dentro não existe pipoca, teia, cronômetro nem "espera há X".
  **Sair** pelo botão, pelo Esc ou pelo elevador da recepção volta para a calçada em frente à porta. No painel,
  **Curtir** (com o total; de dentro, sem a distância da porta) e **Deixar um carimbo** (um dos 8 carimbos da portaria,
  um por prédio por dia); o quadro de cortiça da recepção mostra o carimbo que você deixou hoje e, no seu próprio
  prédio, os do "Enquanto você estava fora". Prédio fechado a visitas, cheio (20 visitantes), bloqueado ou longe demais
  dá um aviso na tela. Nada que age no escritório existe na visita (nem terminal, gaveta, feed, avisos, pedidos de
  permissão, mensagens, Meu dia, timelapse, editor ou renomear sala): ela roda num mundo à parte, que só fala com
  `/api/world/*`, e nenhum passo seu lá dentro sai do computador. As moedinhas da vida social dos agentes visitados
  ficam numa chave à parte e somem ao sair. **Ver como os outros veem** (no cartão **Seu prédio** e na porta do seu
  prédio) entra no seu próprio prédio. **Para o dono:** o selo do topo ganha "👀 N" e o cartão **Seu prédio**, "N
  visitantes agora" (só a contagem, nunca quem); o primeiro visitante de cada conexão dá o aviso "Alguém entrou no seu
  prédio", desligável em **Habblaud World › Avisar quando alguém visitar**. Pelo servidor local, o
  stream da cena repassa o interior (`building`, `building.patch` com a revisão conferida e `resync {building}` num
  salto) e os visitantes (`visitors`, também em `meta.world.building.visitors`).
- **O social leve, sem nenhum texto livre:** na cidade, **L** (ou o botão ❤️ que aparece perto da porta, até 4 passos)
  curte um prédio, e o coração voa até a placa, cujo contador pula; **G** abre a roda com os 10 cumprimentos (teclas 1–9
  e 0, setas ou toque), para quem acabou de te cumprimentar, quem está no cartão ou quem está mais perto, com balões de
  5 s sobre as cabeças (um não cobre o outro) e "G para responder" quando alguém te cumprimenta; **K** bate na porta de
  quem aceita (até 2 passos). O cartão do jogador ganha **Cumprimentar**, **Bloquear** (em dois cliques: vocês deixam de
  se ver) e **Denunciar** (motivos fixos, "Denúncia enviada"); o do prédio, **Curtir**, **Bater**, o código do prédio e
  o selo "não verificado". No minimapa, **Ir para HB-XXXX** e **Visitar um prédio aleatório**, com um fade enquanto o
  personagem vai até a calçada da porta. Na praça, o termômetro da meta coletiva da semana ("10 mil horas de agentes
  trabalhando") e a placa da prefeitura (os prédios acesos e "a cidade consumiu ≈ X esta semana", só com 10 prédios ou
  mais); batida a meta, 20 s de fogos (às vezes em forma de coração) e, para todos, bandeirinhas com lampadazinhas e o
  enfeite da estação. Nas fachadas, o medidor de tokens do dia ao lado da porta, o letreiro com 5 intensidades pela
  faixa da semana (de apagado a neon com faíscas) e confete quando um prédio termina o turno. No celular, os botões
  ficam no canto, só com os ícones. **No escritório:** o chip da barra ganha "❤️ N hoje"; ao conectar, o cartão
  **Enquanto você estava fora** (visitas, likes e os carimbos deixados na portaria, sem quem) aparece no canto e também
  em **Seu prédio**, com o código do prédio para mandar a um amigo; **Avisar quando baterem na porta** (Visibilidade,
  desligado por padrão) mostra "Alguém bateu na porta do seu prédio"; **Habblaud World › Bloqueados**
  lista quem você bloqueou, com **Desbloquear**. **Pelo servidor local:** `POST /api/world/summary/seen` e
  `/api/world/unblock`, e os comandos `like`, `unlike`, `greet`, `block`, `unblock`, `report`, `stamp`, `teleport`,
  `knock` e `summary.seen` na cena, conferidos campo a campo.
- **Rotas locais** (`/api/world/*`, só pelo próprio computador): a conta (cadastro, código, entrar, sair, reenviar,
  trocar a senha, personagem, visibilidade com o aviso de inatividade opcional, dispositivos); o prédio
  (`POST /api/world/pause` e `/resume`, que param o envio antes de responder; `/leave`, que só responde depois de o
  servidor do mundo retirar o prédio; `/join`, que pede a volta antes de reconectar; `PUT /api/world/theme`, com o
  automático virando o tema do dia; `GET /api/world/last-uplink`, a última remessa guardada em
  `~/.habblaud/world-last-uplink.json`, permissão 600); e a conta e os dados (`POST /api/world/delete-account` e
  `/delete-account/confirm`, que só responde depois de fechar o prédio e apagar o `world.json`; `GET /api/world/export`,
  o JSON da conta como anexo, só pela própria página). Uma retomada que o servidor do mundo não confirmou tenta de novo
  com a espera da reconexão. O status do World e o snapshot (`meta.world.building`) trazem o resumo do prédio:
  conectado, pausado, fora do mundo, parado, andares, agentes e a última remessa.
- **Protocolo aberto e transparência:** `shared/world/protocol.ts` e `schema.json` definem tudo o que o Habblaud troca
  com o World (a Fase 4 acrescenta os avisos da porta, os visitantes do dono e o `resync` do prédio; a Fase 5, os
  nomes do social leve: carimbos, metas da cidade, likes do dia, o resumo "enquanto você estava fora", bater na porta e
  o código do prédio; a Fase 6, o `goodbye` `deleted`, o erro `maintenance`, a recusa `implausible` do pacote, o
  `notifyInactivity` da visibilidade, o selo `unverified` do prédio e os formatos da exclusão e da exportação); as
  regras do nome de jogador, os 14 traços, as 20 frases de apresentação, os 10 cumprimentos e os 60 nomes fictícios de
  andar ("Projeto Ipê", "Projeto Jade"...) ficam em `shared/world/`. `docs/world/privacidade.md` lista cada campo do
  pacote e da conexão, com um teste que confere a página contra o `schema.json`; os testes da projeção conferem cada
  chave e que nenhum texto do escritório aparece no pacote. O aviso sobre dados verdadeiros, para pessoas e agentes de
  IA, está no `CLAUDE.md`, no `AGENTS.md`, no `shared/world/README.md` e nos arquivos do World, e o `CONTRIBUTING.md`
  tem a regra de revisão de PRs que mexem nele.
- **Modo demonstração:** `?mock=1&world=logged_out` (ou `waiting`, `approved`) simula o servidor (o código é 123456),
  com o prédio e a remessa de exemplo de `docs/world/privacidade.md`; `?mock=1&world=approved&scene=city` abre uma
  cidade de mentira (20 prédios, o seu no lote (3,1), 5 pessoas andando e uma sentada num banco da praça; `&perf=N`
  enche N lotes), com prédios para visitar (ao vivo, discreto e apagado) e o social leve (bots que se cumprimentam e
  respondem, a meta a 80 % e, com `&fireworks=1`, um botão de teste dos fogos). `npm run shots:world` refaz as capturas
  `docs/screenshots/world-predio.png`, `world-enviado.png`, `world-cidade.png`, `world-cartao.png`, `world-visita.png`,
  `world-visita-painel.png`, `world-social.png` e `world-praca.png`.

## [0.11.0] - 2026-10-13

Para atualizar: `git pull` e `npm run docker:up` (ele também atualiza o mod do Habblaud nas contas). O acesso pelo
celular é opcional e fica desligado até você rodar `npm run remote:setup`; o passo a passo está no README, em
"Celular com login e HTTPS". O Novo agente precisa de `HABBLAUD_PTY=1` no `.env`.

### Adicionado

- **Celular com login e HTTPS (opcional, desligado até configurar):** `npm run remote:setup` pergunta usuário, senha
  (guardada só como hash scrypt no `.env`), um nome para o endereço (`https://<nome>.local`) e, se quiser, um endereço
  próprio (ex.: `meuclaude.home`). Ele cria uma CA local e o certificado do servidor e deixa o anúncio do
  `<nome>.local` rodando como serviço. O celular entra numa **segunda porta** (443 se estiver livre, senão 4748), que
  só é publicada depois do setup: toda requisição nela exige login, e por padrão o celular **aprova e recusa pedidos
  de permissão**; mensagens, terminal (com as **Entregas**: o que cada agente terminou, com resumo e anexos) e o
  Novo agente só com `HABBLAUD_REMOTE_ALLOW`. A porta 4747 continua só no computador e sem login. **Configurações ›
  Acesso pelo celular › Sair** encerra o login daquele aparelho (uma cópia do cookie também deixa de valer). Contribuição de
  @jasminaladdn (#96).
- **Novo agente (botão + na barra do topo, opt-in com `HABBLAUD_PTY=1`):** começa uma sessão do Claude Code em
  segundo plano no computador (`claude --bg`), na pasta escolhida (os projetos recentes vêm sugeridos), com o pedido
  escrito e anexos; ela aparece no escritório e recebe mensagens e permissões pelo Habblaud. Numa pasta que o Claude
  Code ainda não conhece, abre a tela de sessão nova do app do Claude preenchida. No Docker, quem começa é o auxiliar
  do host (`npm run codex:bridge`, que agora roda também sem o Codex). Pelo celular, também precisa de `spawn` em
  `HABBLAUD_REMOTE_ALLOW`.
- **Ditado** no Novo agente e na caixa de mensagem: o navegador grava e o **Whisper local** transcreve (`whisper-cli`
  + `ffmpeg` + um modelo multilíngue); a voz não sai do computador. Sem eles, o botão não aparece.
- **Espera de até 24 h pelo escritório:** `HABBLAUD_PERMISSION_TIMEOUT` aceita até 86400 s (antes 1800, e o plugin
  cortava em 330 s). O padrão continua 5 min. Numa espera longa, sem nenhuma página que responda por 5 min (e sem o
  celular com login configurado para responder), o pedido volta ao terminal.
- **Mensagens para sessões do app desktop do Claude:** o plugin `habblaud-mensagens` também pergunta ao Habblaud nas
  sessões com `CLAUDE_CODE_ENTRYPOINT=claude-desktop` (antes só nas que tinham terminal na tela).
- Pedido esperando sem botões no escritório (o hook já devolveu ao terminal, ou a sessão abriu sem o plugin): o
  rodapé do terminal diz para responder no Claude Code (ou no Codex).

### Segurança

- Na porta remota, quem separa "do próprio computador" de "da rede" é a porta em que a conexão chegou, nunca o
  cabeçalho Host. As rotas dos hooks, dos plugins e do auxiliar do host, o terminal interativo, o editor de
  personagem e renomear salas nunca valem por ela, nem com login.
- A CA local só assina `localhost`, nomes `.local`, o endereço próprio e IPs de rede privada (`nameConstraints`
  crítico): mesmo com a chave vazada, um certificado para outro site é recusado. A chave nunca vai para o container.
- Sessão em cookie `HttpOnly`, `SameSite=Strict` e `Secure`, assinado com HMAC (trocar a senha derruba todas). Uma
  conferência de senha por vez, contada antes do scrypt; depois de 5 senhas erradas seguidas, cada tentativa espera
  de 1 s a 5 min.
- No Docker, o auxiliar do host só lê arquivos de entrega de pastas de projeto conhecidas (as que o Claude Code tem em
  `<conta>/projects`), da pasta temporária e dos anexos, e nada com cara de segredo. Arquivos e ditado usam rodadas
  com espera (o servidor só responde quando chega trabalho), em vez de perguntar a cada meio segundo.

### Corrigido

- Celular: tocar num campo de texto não dá mais zoom (o Safari do iPhone amplia campos com letra menor que 16 px).
- No timelapse, os avisos do canto ficam acima da barra de reprodução, em vez de cobrir a linha do tempo e os botões.
- Com muitas contas ou a janela estreita, os cartões de uso vão para uma segunda linha da barra superior, em vez de
  cobrir os botões da direita (zoom, Meu dia, Configurações, Ajuda).
- No celular (até 480 px), a barra superior não corta mais o logo e o botão do painel lateral: os
  contadores descem para a linha dos cartões de uso.
- "Meu dia" no celular: o seletor Demonstração | Dados reais não sai mais da tela (em francês, nem a 390 px).
- Dois pedidos de permissão do mesmo agente no mesmo instante: o detalhe do mais novo não diz mais que há outro
  pedido esperando atrás dele.
- "Meu dia": o limite de 1.000 esperas por dia vale também quando todas estão abertas (antes a lista e o arquivo do
  dia cresciam sem teto).
- Um arquivo de conversa reescrito no mesmo lugar (em vez de só crescer) volta a ser lido do começo; antes o
  conteúdo novo era ignorado ou lido a partir do meio.

## [0.10.0] - 2026-10-13

Para atualizar: `git pull` e `npm run docker:up`. A interface segue o idioma do navegador (ou Configurações › Idioma).
Os textos que o servidor monta continuam em português; para outro idioma, defina `HABBLAUD_LANG` (`en`, `es` ou `fr`)
no `.env` antes do `docker:up`. Em outubro, o tema automático já deixa o escritório no clima de Halloween; para o
visual de sempre, escolha **Nenhum** em Configurações › Aparência.

### Adicionado

- **Temas do escritório** em Configurações › Aparência: decoração em pixel art (árvores com presentes, guirlandas e
  neve nas janelas no Natal; abóboras, fantasmas, teias e morcegos no Halloween), luzes, tapetes e acessórios nos
  personagens. **Automático**, o padrão, segue o calendário: Halloween de 1º a 31 de outubro e Natal de 1º de
  novembro a 26 de dezembro (no resto do ano, o visual de sempre). **Nenhum** deixa o visual de sempre o ano todo, e
  **Natal** e **Halloween** fixam um tema. A escolha fica salva no navegador.
- **Interface em inglês, espanhol e francês.** Os textos passam por `tr()` (`shared/i18n.ts`), com o português como
  língua de origem: um texto sem tradução continua em PT. A interface segue o navegador e pode ser fixada em
  **Configurações › Idioma**. Os textos montados pelo servidor (atividades, avisos, terminal, logs e scripts de
  instalação) seguem `HABBLAUD_LANG` (`pt-BR`, `en`, `es` ou `fr`) e, sem ele, o idioma do sistema, menos o inglês
  (muita máquina e todo container vêm em inglês por padrão): para o servidor em inglês, `HABBLAUD_LANG=en`.
  `npm run i18n:check` lista os textos ainda sem tradução. O francês veio da comunidade (#67).
- **README em inglês**, com versões em português (`README.pt-BR.md`), espanhol e francês, e a linha de idiomas no
  topo de cada um.

## [0.9.0] - 2026-10-13

Para atualizar: `git pull` e `npm run docker:up`. O terminal interativo vem desligado e só funciona fora do Docker:
`npm install`, `npm run build` e `HABBLAUD_PTY=1 npm start` (leia antes o aviso em "Privacidade e segurança" no
README).

### Adicionado

- **Terminal interativo (opt-in, `HABBLAUD_PTY=1`):** o Claude Code de verdade numa janela do escritório, com abas para
  os agentes do mesmo projeto. **Nova sessão** abre um Claude Code na pasta da sala; **Assumir daqui** encerra a sessão
  aberta noutro terminal e continua a mesma conversa aqui (`claude --resume`); **Encerrar** e o X das abas fecham a
  sessão, aqui ou noutro terminal. Só para sessões do Claude Code (nem Codex nem demo). Antes de encerrar um processo de
  fora, o Habblaud confere que o PID ainda é aquele Claude Code. Usa `node-pty` e `@xterm/headless` (dependências
  opcionais); a tela volta inteira ao reconectar ou trocar de aba, com os modos que o Claude ligou. Ao iniciar, abre
  um terminal de teste: se o `node-pty` ou o `claude` não funcionarem, o recurso fica desligado, com o motivo no log
  (no macOS, antes ele corrige a permissão de execução que falta no `spawn-helper` do `node-pty` 1.1.0).
- **Abas e atalho do terminal:** a janela de terminal ganhou abas com os agentes principais do mesmo projeto (com o
  começo do que cada um faz), e a lista lateral, um atalho ao lado de cada agente que abre o terminal dele. Com um
  terminal aberto, clicar noutro agente da lista troca a janela para o dele. Valem também para o terminal ao vivo, com
  o interativo desligado.

### Corrigido

- Mensagem mandada pelo escritório não vai mais para a conversa errada: se o agente trocar de conversa (`/clear`,
  `/resume` ou outro thread no Codex) antes de buscá-la, ela falha com o motivo em vez de entrar na conversa nova.
- As tarefas antigas e seus estados são preservados ao recuperar sessões com histórico longo que ganharam novas tarefas.
- O detalhe da atividade não mostra mais o segredo de webhooks (Slack, Discord e Telegram) nem de tokens `npm_` e
  `hf_` colados num comando.
- Mensagens ao Codex no Docker agora são entregues uma por vez por sessão e confirmadas individualmente, reduzindo
  falhas prematuras e reenvios duplicados.
- Listas de tarefas malformadas do Claude Code não interrompem a leitura; o escritório preserva as demais atividades
  do mesmo lote, inclusive nos subagentes.
- Uma imagem do Codex gravada no Windows (disco `C:` ou pasta de rede `\\servidor\...`) aparecia com o caminho
  errado na atividade e no terminal (`/C:/...`, ou a pasta sem o servidor). Agora o caminho é o do arquivo de origem.
- Salvar um personagem ou voltar ao sorteio não fecha mais outra edição aberta enquanto a resposta chega, nem mostra
  nela um erro da edição anterior.
- Uma linha enorme numa conversa, ou uma linha que nunca fechava, ficava inteira na memória e a leitura
  ia ficando mais lenta. Uma linha acima de 8 MB agora é ignorada, e o Habblaud segue na linha seguinte.
- Sessões do Codex revertidas passam a mostrar o turno atual no escritório e no terminal, mesmo quando o arquivo da
  conversa anterior continua no disco.
- No timelapse, a linha do tempo do agente deixa de mostrar o que aconteceu depois do momento reproduzido quando se
  volta no tempo. Uma resposta de histórico que ainda estava a caminho também não entra durante o replay.
- No timelapse, os tempos dos painéis acompanham a reprodução e ficam parados ao pausar, junto com o escritório e o
  selo do replay.
- O feed pausado guarda só os 50 eventos mais recentes e libera os dados de sessões antigas, mantendo a contagem de
  novidades.
- No timelapse, as setas no controle de velocidade passam a trocar a velocidade, em vez de mover a câmera do escritório.
- O escritório evita conexões ao vivo duplicadas e libera os recursos de rede e fontes ao ser fechado.
- `usage:install`, `hooks:install`, `mod:install` e `codex:install` param quando o arquivo de configuração muda
  no meio da instalação, em vez de apagar essa edição (ela também sumia do backup). Rode o comando de novo; o
  backup passa a ser o arquivo que foi substituído.

## [0.8.0] - 2026-10-09

Para atualizar: `git pull` e `npm run docker:up`. Renomear salas e editar o personagem funcionam só pelo próprio
computador (a mesma trava do terminal). Os nomes das salas ficam em `rooms.json` e os personagens em `names.json`, na
pasta de dados do Habblaud; voltar para a 0.7 faz os personagens escolhidos sumirem na primeira gravação.

### Adicionado

- A lista lateral e a dica do personagem mostram o título da sessão (nos subagentes, a tarefa) embaixo do nome. Na
  lista, o agente principal parado há 1 minuto ou mais mostra **ocioso 12 min** no lugar de "Principal"; na dica, o
  estado vem com há quanto tempo ele está assim (**há 12 min**).
- **Janelas móveis:** o terminal e a gaveta do agente se soltam do lugar arrastando pela barra, mudam de tamanho por
  qualquer borda ou quina e voltam ao lugar com um duplo clique na barra. O terminal ganha o botão **Expandir na tela
  toda**. Posição e tamanho ficam guardados no navegador; em tela estreita tudo continua fixo. Solta, a gaveta deixa de
  reservar a lateral do escritório.
- **Reordenar a lista lateral:** arrastar a linha de um agente principal muda a ordem dos agentes da sala, e arrastar
  o cabeçalho de uma sala muda a ordem das salas (no prédio elas ficam onde estão). A ordem fica guardada no
  navegador; a dos agentes vai pela sessão do Claude Code e sobrevive a retomar a sessão.
- **Renomear sala:** botão direito numa sala (na lista lateral ou no escritório) abre um campo para dar outro nome a
  ela; vazio volta ao nome da pasta. O nome fica no servidor (`rooms.json`, na pasta de dados do Habblaud), por pasta:
  vale em qualquer navegador e sobrevive a reinícios. Na gaveta da sala, um lápis ao lado do nome abre o mesmo campo.
  Só pelo próprio computador; as salas de demonstração não mudam.
- **Editar o personagem de um projeto.** Nos detalhes do agente principal, o lápis ao lado do nome abre um editor
  com o nome, **Sortear** e as peças (pele, cabelo, barba, olhos, roupa, sapatos e acessório), com prévia. A escolha
  vale para o projeto: a próxima sessão na mesma sala chega com o mesmo personagem, e **Voltar ao sorteio** desfaz.
  Só funciona pelo próprio computador, como o terminal.

### Alterado

- A linha do tempo do agente mostra os 15 itens mais recentes, com **Mostrar mais** (mais 15 a cada clique, até
  os 200 guardados) e **Mostrar menos** (volta aos 15). Antes eram 80 de uma vez.

### Corrigido

- No Windows, as mensagens ao Codex procuravam `codex` no PATH e achavam o script que o npm instala ao lado do
  executável: o Habblaud dizia que as mensagens estavam ligadas, mas cada entrega falhava, porque o script não roda
  sem shell. Agora a busca é pelo `codex.exe`. Com o Codex instalado só pelo npm, aponte `HABBLAUD_CODEX_BIN` para um
  `codex.exe`.
- No Windows, o comando de statusline que já existia antes do `npm run usage:install` (o Habblaud o guarda e
  continua rodando) era executado pelo `cmd.exe`, e o que funcionava no Claude Code (aspas simples, variáveis, pipes)
  quebrava. Agora ele roda no Git Bash, como no Claude Code: o de `CLAUDE_CODE_GIT_BASH_PATH` ou o da instalação do
  Git. Sem o Git Bash, continua no `cmd.exe`.
- No Windows, os instaladores (`usage:install`, `hooks:install`, `codex:install` e `mod:install`) mostravam os
  caminhos da pasta do usuário por inteiro (`C:\Users\...`) em vez de `~/...`.
- A suíte de testes (`npm test`) passa no Windows: os testes que supunham caminhos, shell ou permissões do Linux e do
  macOS agora valem nos três sistemas, e os poucos que dependem de algo que o Windows não tem são pulados nele.

## [0.7.0] - 2026-10-09

Para atualizar: `git pull` e `npm run docker:up` (o Codex aparece sozinho, se houver uma pasta `~/.codex`). Para ver o
Codex ao vivo e aprovar pelo escritório: `npm run codex:install` e aprove os hooks do Habblaud em `/hooks` no Codex
(reinicie o Codex antes, se ele estava aberto). Com o Habblaud no Docker, para mandar mensagens ao Codex deixe
`npm run codex:bridge` rodando no Mac.

### Adicionado

- **Codex no escritório.** As sessões do Codex da OpenAI (a CLI `codex` e o app) entram no escritório como as do
  Claude Code: cada projeto é uma sala (a mesma do Claude Code, quando os dois estão no mesmo projeto), cada sessão um
  personagem com o selo **CODEX**, com atividade, subagentes, terminal, histórico, uso de 5 horas e semanal (com a
  idade dos números e "sem cota" quando acabam os créditos) e o Meu dia (só tokens: o Codex não informa custo). Sem
  instalar nada, o Habblaud lê os arquivos do Codex (`~/.codex`, `CODEX_HOME` ou `~/.codex*`; `HABBLAUD_CODEX_DIRS`
  escolhe as pastas e `HABBLAUD_CODEX=0` desliga). Uma sessão entra com a primeira mensagem, que é quando o Codex diz
  a pasta do projeto (uma CLI aberta e ainda sem conversa não aparece). No Docker, só `sessions/`,
  `archived_sessions/` e `thread-writer-locks/` são montadas, somente leitura.
- **Codex ao vivo e aprovar pelo escritório:** `npm run codex:install` acrescenta os hooks do Habblaud no
  `~/.codex/hooks.json` (com backup; os hooks de outros apps ficam no mesmo lugar) e, depois de aprová-los em `/hooks`
  no Codex, a atividade é a de agora (e não só quando cada passo termina) e os pedidos de aprovação esperam a sua resposta no
  escritório por até 25 s (`-- --espera <s>`) antes de irem ao terminal. `codex:status` confere e `codex:uninstall`
  tira.
- **Mensagens ao Codex** pela mesma caixa **Mandar mensagem**, via `codex queue` (entram quando a sessão termina o que
  está fazendo). No Docker, deixe `npm run codex:bridge` rodando no Mac.

### Alterado

- Uma pasta do Codex nunca vira conta do Claude Code, nem listada em `HABBLAUD_CLAUDE_DIRS` ou `CLAUDE_CONFIG_DIR`; o
  servidor e o `docker:up` avisam.
- Com quatro contas ou mais, os cartões de uso do topo ficam mais estreitos e os botões de zoom somem até 1700 px de
  largura, para não invadir os botões da direita.

## [0.6.0] - 2026-10-09

Para atualizar: `git pull`, `npm run docker:up` e `npm run mod:install` (traz o plugin de permissões novo e o de
mensagens); nas sessões já abertas, `/reload-plugins`.

### Adicionado

- **Responder as perguntas do agente pelo escritório.** Quando o agente faz uma pergunta (`AskUserQuestion`), o cartão
  de perguntas mostra cada uma com as opções e as descrições: escolha uma (ou várias, quando a pergunta deixa),
  escreva a sua em "Outro" ou recuse. Como nas permissões, o diálogo continua no terminal e vale o que você responder
  primeiro; a tecla `P` e o contador "precisam de você" também levam às perguntas. Precisa do plugin
  `habblaud-permissoes` desta versão.
- **Mandar mensagens aos agentes pelo escritório.** Os detalhes de cada agente principal ganham a seção "Mandar
  mensagem": o texto entra na sessão como se você tivesse digitado no terminal dela (com o agente ocupado, entra
  quando ele terminar o turno), e a caixa mostra se a mensagem está na fila, foi entregue ou não. Vem de um plugin
  novo, `habblaud-mensagens` (Claude Code 2.1.287+), instalado pelo `npm run mod:install` (`-- --sem-mensagens` deixa
  de fora); o `npm run docker:up` não o instala sozinho, só avisa. Segue a trava do terminal (só acesso local) e
  `HABBLAUD_MENSAGENS=0` desliga. Leia o aviso em "Privacidade e segurança" no README: qualquer programa desta máquina
  consegue mandar mensagem às sessões que têm o plugin.

### Alterado

- **O terminal (tecla `T`) aceita digitação.** Deixou de ser "somente leitura": nos agentes principais, o rodapé
  virou a caixa de mensagem (`Enter` manda, `Shift+Enter` quebra a linha). Subagentes e sessões do histórico continuam
  só para ler.
- `npm run mod:install`, `mod:status` e `mod:uninstall` cuidam também do plugin `habblaud-mensagens`, e o
  `mod:status` diz se o Habblaud está com as mensagens ligadas.

## [0.5.0] - 2026-10-09

### Adicionado

- O cartão "Precisa de você" mostra as perguntas do `AskUserQuestion` completas, com as opções e as descrições
  (até 4 perguntas, com 6 opções cada). É só para ler: a resposta continua sendo dada no Claude Code.
- Verificação automática no GitHub (Actions): a cada push na `main` e a cada pull request, o projeto roda
  `typecheck`, testes e build no Node 22.12, a versão mínima que o `package.json` declara.

### Corrigido

- Quando um arquivo de transcript era apagado e outro, maior, era criado no lugar, o Habblaud podia não perceber a
  troca: alguns sistemas de arquivos reaproveitam o número (inode) do arquivo apagado, e só o inode era comparado.
  Agora também contam o momento de criação do arquivo (quando o sistema o informa) e o começo dele, e a leitura
  recomeça do início do arquivo novo.
- No Windows, com o Node 23 até o 24.19, o hook do plugin `habblaud-permissoes` caía ao sair (código 0xC0000409,
  um bug do Node: nodejs/node#56645) logo depois de receber a resposta do escritório. A decisão chegava antes da
  queda, mas sem decisão (como em "Responder no terminal") a sessão podia registrar um erro do hook. Agora o hook
  sai sem cair.
- O `npm install` alterava o `package-lock.json` (o do repositório estava desatualizado em relação ao
  `package.json`), e por isso o `git pull` da versão seguinte parava com "Your local changes … would be
  overwritten". Agora o arquivo fica igual. Quem já tem a alteração roda uma vez `git checkout -- package-lock.json`
  antes do `git pull`.
- No Windows, o mod não gravava o uso de 5 horas e semanal quando o `HOME` não estava definido (o normal fora do Git
  Bash): agora usa o `USERPROFILE`. E um `CLAUDE_CONFIG_DIR` com `\` (ex.: `C:\Users\voce\.claude-conta2`) virava um
  nome de arquivo inválido; agora dá a mesma conta, inclusive com o Habblaud no Docker.

## [0.4.0] - 2026-10-08

### Alterado

- **O CodeTown agora se chama Habblaud.** O nome muda em toda parte: interface, logotipo, placa da recepção, totem da
  entrada, prévia de link, repositório (`github.com/marmottajr/habblaud`), marketplace e plugins do Claude Code
  (`habblaud` e `habblaud-permissoes`, com o comando `/habblaud`), variáveis de ambiente (`HABBLAUD_*`), pasta de
  estado (`~/.habblaud`) e Docker (container e imagem `habblaud`, volume `habblaud-data`).
- Para quem vem do CodeTown: rode `npm run mod:install` uma vez (troca o marketplace e os plugins antigos pelos novos
  em cada conta) e `npm run docker:up` (tira o container antigo e copia os nomes, a linha do tempo e as estatísticas
  do volume `codetown_codetown-data` para o novo, sem apagar o antigo). A pasta `~/.codetown` e as preferências e
  moedinhas guardadas no navegador passam para os nomes novos sozinhas. As variáveis `CODETOWN_*` não valem mais:
  renomeie para `HABBLAUD_*` no `.env` (o servidor e o `docker:up` avisam). Detalhes no README, em
  "Vindo do CodeTown".

## [0.3.2] - 2026-10-08

### Corrigido

- Quando um terminal fechava e a sala dele era desmontada, ficava um jardim no meio do prédio, entre salas. Agora a
  sala mais distante se muda para a vaga: é montada lá, ainda apagada; o primeiro a chegar acende a luz e cada um
  volta para a mesma mesa. O endereço antigo apaga e é desmontado, e o prédio encolhe. Uma sala que abre ocupa a
  primeira vaga livre, e a carga inicial já vem sem buracos.
- Quem estava a caminho de algo que deixou de existir, como o bebedouro de uma coluna do corredor que sumiu quando o
  prédio encolheu, era teletransportado. Agora muda de plano e segue andando.

## [0.3.1] - 2026-10-08

### Corrigido

- Quem cochilava na mesa (ocioso há mais de 10 minutos) e levantava para uma roda, uma festa ou um passeio saía
  andando com o "zzz" na cabeça. Agora o "zzz" só aparece enquanto o personagem dorme.

## [0.3.0] - 2026-10-08

### Adicionado

- **Mod do Habblaud para o Claude Code** (2.1.287 ou mais novo): `npm run mod:install` instala, em cada conta, o
  marketplace desta pasta com o mod `habblaud` (uso de 5 horas e semanal ao vivo, uma linha no terminal quando outra
  sessão precisa de você e o comando `/habblaud`) e o plugin `habblaud-permissoes` (responder permissões pelo
  escritório; `-- --sem-permissoes` deixa de fora). `npm run mod:status` mostra o que cada conta tem e
  `npm run mod:uninstall` tira tudo. O `npm run docker:up` atualiza o mod de quem já instalou.

### Mudado

- O tap de statusline (`npm run usage:install`) e o hook de permissão (`npm run hooks:install`) viram o jeito antigo,
  para o Claude Code anterior ao 2.1.287. O `npm run mod:install` tira os dois da conta (com backup), porque o mod faz
  o mesmo. A interface e o README passam a ensinar o `npm run mod:install`.
- O script do hook de permissão mudou para `mod/habblaud-permissoes/hooks/permission-hook.mjs`. O caminho antigo
  (`scripts/permission-hook.mjs`) virou um atalho, então quem instalou o hook antes continua funcionando.
- Em Contas e uso, a origem dos números diz quando vêm do mod ("ao vivo (mod do Habblaud)").
- O leitor do uso ao vivo ignora um arquivo lido pela metade e fica com o último número bom, em vez de esconder a
  conta por um ciclo.

## [0.2.0] - 2026-10-08

Primeira versão publicada.

### Adicionado

- **Versão e atualizações:** a versão em uso aparece na barra superior e em Configurações › Sobre. A cada 6 horas o
  Habblaud confere as releases no GitHub; quando sai uma versão nova, aparece o selo **Nova versão**, com um aviso e o
  link do que mudou. `HABBLAUD_UPDATE_CHECK=0` desliga a consulta.
- **Meu dia** (tecla M): para onde foi o tempo dos agentes, quanto tempo esperaram você, tokens e custo, com 30 dias
  de histórico.
- **GitHub no escritório:** PR aberto ou mergeado e release publicada viram festa na sala; CI vermelho liga o alarme,
  até um CI verde.
- **Responder pelo escritório** (tecla P): com o hook instalado (`npm run hooks:install`), aprovar, recusar ou
  "sempre permitir" pedidos de permissão sem ir ao terminal. Só com acesso local.
- **Timelapse do dia** (tecla L): o escritório reproduz o dia em alta velocidade.
- **Terminal somente leitura** (tecla T): a conversa de cada agente, ao vivo, no estilo do Claude Code, com busca,
  filtro, botão de copiar e histórico das sessões dos últimos 7 dias. Só com acesso local.
- **Dia e noite** pela hora local e **sons** sintetizados no navegador (desligados por padrão).
- **Vida social:** quem está à toa se junta em rodas (TV, videogame, pingue-pongue, papo na copa, jokenpô valendo
  moedinhas), com personalidades, amizades e rivalidades.
- **Esperando o shell:** o agente que espera um comando longo fica na mesa com a ampulheta, e a espera vira uma gag.
- Forks de sessão aparecem no escritório.
- A página aberta se recarrega sozinha quando o servidor passa a servir outra versão.
- O container usa o fuso horário do computador.
- **O escritório:** cada projeto aberto no Claude Code vira uma sala e cada sessão, um personagem com nome próprio.
  Subagentes chegam, trabalham e entregam ao principal. Mostra as duas contas, com o uso de 5 horas e semanal de
  cada uma (tap de statusline), além de feed de atividade, avisos e modo demonstração. Roda no Node ou no Docker local.

[Não lançado]: https://github.com/marmottajr/habblaud/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/marmottajr/habblaud/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/marmottajr/habblaud/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/marmottajr/habblaud/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/marmottajr/habblaud/compare/v0.11.0...v1.0.0
[0.11.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.11.0
[0.10.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.10.0
[0.9.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.9.0
[0.8.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.8.0
[0.7.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.7.0
[0.6.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.6.0
[0.5.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.5.0
[0.4.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.4.0
[0.3.2]: https://github.com/marmottajr/habblaud/releases/tag/v0.3.2
[0.3.1]: https://github.com/marmottajr/habblaud/releases/tag/v0.3.1
[0.3.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.3.0
[0.2.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.2.0
