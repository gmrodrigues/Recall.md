# Recall.md

Aprendizagem com fichas de conteúdo, com arquivos Markdown, kanban, quizzes e cartões de memorização. CLI, TUI e interface web operam sobre o mesmo diretório `recall/`. Funciona sem Backlog.md; quando existe uma tarefa correspondente, reconhece o vínculo e apresenta seu contexto.

## Instalar e abrir um estudo independente

Cada estudo é uma pasta sua. O Recall.md grava `recall/` dentro dela. Você pode usar o mesmo aplicativo para vários estudos, cada um com seus decks, fichas e histórico. Backlog.md é opcional.

A **AppImage para Linux x86_64** inclui Node.js, CLI, TUI e a interface web compilada. O instalador verifica o SHA-256 da release `latest` antes de instalar ou atualizar `recall-appimage`. [Baixar AppImage](https://github.com/gmrodrigues/Recall.md/releases/latest) · [Opção Docker](#instalar-recallmd-com-docker)

### Primeiro exemplo · Vocabulário em inglês

Comece pelo estudo de vocabulário em inglês de **Marcelo Henrique Goncalves (@billmask)**. Ele reúne 91 fichas com material, quizzes e cartões de memorização. [Estudo incluído no Recall.md](examples/example-vocabulario/README.md) · [Contribuição original](https://github.com/billmask/Recall.md/tree/7ea324a987e14d08ecc3501f0d2a125dc65ae061/example-vocabulario)

Instale a AppImage com o comando abaixo e crie uma pasta vazia para o estudo.

```bash
curl -fsSL https://raw.githubusercontent.com/gmrodrigues/Recall.md/22a10c01a99a3b0d91e730e835c4fdc3cd5ac85b/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

mkdir -p "$HOME/estudos/vocabulario-ingles"
cd "$HOME/estudos/vocabulario-ingles"
curl -fsSLo vocabulario-ingles.json \
  https://raw.githubusercontent.com/gmrodrigues/Recall.md/main/examples/example-vocabulario/vocabulario-ingles.json
recall-appimage init
recall-appimage unit import vocabulario-ingles.json
recall-appimage unit list
recall-appimage browser --port 6421
```

Rode a primeira linha novamente para atualizar. A URL fixa a revisão do instalador, que sempre busca o pacote na release `latest`. Importe o arquivo uma vez ao iniciar o estudo. Para retomar, volte à mesma pasta e execute `recall-appimage browser`. Fora de um estudo, `recall-appimage` sem argumentos abre o servidor com o estudo padrão na pasta de dados local.

Se faltar FUSE, execute `export APPIMAGE_EXTRACT_AND_RUN=1` no mesmo terminal antes de rodar os comandos `recall-appimage`.

Abra **http://127.0.0.1:6421**. No **Quadro de estudos**, abra **O alfabeto** e confira as abas **Material**, **Quiz** e **Cartões de memorização**. Para testar a gravação, responda ao quiz, reinicie o servidor na mesma pasta e consulte a aba **Tentativas**. Encerre com Ctrl+C. Se a porta estiver ocupada, use `recall-appimage browser --port 6422` e abra **http://127.0.0.1:6422**.

### Criar um estudo próprio

Crie outra pasta e rode `recall-appimage init` nela. Adicione uma ficha pelo botão **Nova ficha de conteúdo** ou gere um JSON com um agente de IA. Use um dos prompts abaixo.

#### Prompt 1 · Como funciona o Recall.md

> Quero estudar como o Recall.md organiza fichas, quizzes e cartões. Parta de uma pasta vazia e leia estas fontes públicas diretamente pelas URLs raw, sem clonar o repositório:
> - Guia para agentes: https://raw.githubusercontent.com/gmrodrigues/Recall.md/main/AGENTS.md
> - Instalação e uso: https://raw.githubusercontent.com/gmrodrigues/Recall.md/main/README.md
> - Formato das fichas: https://raw.githubusercontent.com/gmrodrigues/Recall.md/main/docs/format.md
> - Modelo JSON: https://raw.githubusercontent.com/gmrodrigues/Recall.md/main/examples/primeira-etapa.json
>
> Use a AppImage e o instalador público indicado no início do README. Execute a instalação novamente se precisar atualizar `recall-appimage`. Crie `~/estudos/como-funciona-o-recall`, entre nessa pasta e rode `recall-appimage init`.
>
> Crie três fichas no deck **Como funciona o Recall.md**, uma para cada assunto. Em cada ficha, inclua uma página de material, duas questões com gabarito explicado e três cartões. Cite a URL raw e a seção de cada fonte de conteúdo. Salve a lista em `estudo.json` dentro da pasta do estudo. Nessa mesma pasta, rode `recall-appimage unit import estudo.json`, confirme os IDs com `recall-appimage unit list` e inicie a interface com `recall-appimage browser`. Informe os IDs e a URL local. Eu vou responder aos quizzes.

#### Prompt 2 · Documentação completa do Godot

> Quero criar um estudo no Recall.md sobre **toda a documentação estável do Godot** em https://docs.godotengine.org/en/stable/. Use o índice oficial para mapear as seções, incluindo tutoriais e referência da API, e registre a versão do Godot indicada pela documentação. Divida o percurso em decks temáticos e fichas de tamanho manejável. Acompanhe quais seções já foram cobertas e quais faltam.
>
> Parta de uma pasta vazia e leia o [guia para agentes](https://raw.githubusercontent.com/gmrodrigues/Recall.md/main/AGENTS.md), o [README](https://raw.githubusercontent.com/gmrodrigues/Recall.md/main/README.md), o [formato das fichas](https://raw.githubusercontent.com/gmrodrigues/Recall.md/main/docs/format.md) e o [modelo JSON](https://raw.githubusercontent.com/gmrodrigues/Recall.md/main/examples/primeira-etapa.json) pelas URLs públicas raw. Instale a AppImage conforme as instruções no início do README. Crie `~/estudos/godot-documentacao`, entre nessa pasta e execute `recall-appimage init`.
>
> Para cada ficha, escreva um objetivo, um resumo, questões com gabarito explicado e cartões de memorização. Cite as URLs e as seções oficiais. Gere os arquivos JSON dentro da pasta de estudo e importe por tema com `recall-appimage unit import arquivo.json`. Confirme os IDs com `recall-appimage unit list` e abra o navegador com `recall-appimage browser`. Informe a URL local e o progresso da cobertura. Eu vou responder aos quizzes.

Veja o [JSON de uma ficha](examples/primeira-etapa.json) e os [prompts e skills para agentes](AGENTS.md).

### Contribuir com o projeto

Você pode instalar e usar o Recall.md para estudar. **Contribuir é opcional.**

- Para sugerir uma melhoria ou relatar um problema, abra uma issue. Inclua o comando que usou e o resultado esperado. Use dados de demonstração ao anexar exemplos. [Issues do Recall.md](https://github.com/gmrodrigues/Recall.md/issues)
- Para enviar um exemplo, melhorar a documentação ou mudar o código, faça um fork e abra um pull request com a mudança e uma descrição de como verificá-la. Exemplo de estudo deve incluir autoria, fontes e passos para reproduzir. [Pull requests do Recall.md](https://github.com/gmrodrigues/Recall.md/pulls)

Para trabalhar no código, use Node.js 22.22.2+, 24.15+ ou 26+, conforme `package.json`. No clone do fork, rode `npm ci`, `npm run check`, `npm test` e `npm run build` antes de enviar mudanças de código.

## Fluxo

1. Crie uma etapa, descreva seu objetivo e escolha um deck.
2. Adicione material, questões de múltipla escolha ou texto livre, e cartões. Web e TUI têm formulários; agentes podem importar JSON pela CLI.
3. Organize o kanban por arrastar e soltar ou pelo estado no formulário de edição.
4. Responda ao quiz. A tentativa registra as respostas e uma cópia da referência daquela versão. Múltipla escolha tem correção automática; texto livre mostra a referência e permite autoavaliação explícita.
5. Crie cartões de memorização manualmente ou a partir do **gabarito atual** de uma questão. Uma resposta incorreta não vira gabarito.
6. Revise por deck: tente lembrar, revele o verso e avalie a recordação. Cada revisão é preservada.

Estados iniciais: **A estudar → Estudando → Praticando → Em revisão → Concluído**. São organização do trabalho, não demonstração de domínio; esta versão não exige nota mínima para mudar de coluna.

## TUI — terminal interativo

```bash
recall tui
# Sem instalação global:
node /caminho/Recall.md/bin/recall.js --cwd /pasta/de/estudo tui
```

Inicie com `recall init` se a pasta ainda não tiver um espaço de estudo. A TUI usa os mesmos arquivos e regras da CLI e da web. Requer terminal interativo de pelo menos **50 colunas × 14 linhas**; em terminais menores, redimensione ou use Ctrl+C para sair. Não aceita `--json`; scripts devem usar os comandos CLI existentes.

O quadro mostra colunas por estado, seleção destacada e rolagem de etapas. Em janelas estreitas, mostra apenas as colunas ao redor da seleção; use ←/→ para alcançar as demais. Tab alterna quadro e lista. A interação se inspira nos atalhos do Backlog.md, com implementação própria em Node.js/readline e sem dependência de sua TUI.

| Onde | Teclas | Ação |
|---|---|---|
| Quadro/lista | Setas ou `h/j/k/l`, Enter | Navegar e abrir etapa |
| Quadro/lista | Tab, `/`, `d` | Alternar quadro/lista, buscar, filtrar deck |
| Quadro/lista | `n`, `e`, `m`, `r` | Criar, editar, mover estado, revisar decks |
| Detalhes | `q`, `a`, `f`, `r`, `t`, `s` | Quiz, nova questão, novo cartão, revisão do deck, tentativas, vínculos |
| Formulário | Tab/Enter, Shift+Tab | Próximo campo, campo anterior |
| Formulário | Ctrl+J, Ctrl+U, Backspace | Nova linha, limpar campo, apagar no final |
| Formulário | Ctrl+S, Esc | Salvar, cancelar |
| Quiz de alternativas | ↑/↓ ou 1–9, Enter | Selecionar e confirmar |
| Quiz de texto | Digitar, Ctrl+J, Enter | Responder, nova linha, confirmar |
| Resultado | ←/→, Enter, `f` | Percorrer, continuar, criar cartão do gabarito atual |
| Resultado de texto | `1`, `2` | Autoavaliar como correto ou retomar |
| Revisão | Espaço/Enter, depois `1`–`4` | Revelar; repetir, difícil, lembrei ou fácil |
| Material/contexto | ↑/↓ ou `j/k`, PgUp/PgDn, Home/End | Rolar |
| Quadro/lista ou detalhes | Ctrl+R | Reler arquivos alterados externamente |
| Navegação | `?`, Esc, Ctrl+C | Ajuda, voltar/cancelar, encerrar |

Na tela principal, `q` também encerra. Nos detalhes, `q` inicia o quiz. Em campos de texto, letras continuam sendo texto, não atalhos. Enter confirma a resposta e avança; a tentativa só é gravada ao enviar a última questão. Esc cancela respostas ainda não enviadas. Se o material mudar enquanto você responde, reinicie o quiz para não misturar versões.

A revisão exige revelar o verso antes de registrar uma avaliação. Encerrar uma sessão conserva as revisões já gravadas. O resultado permite criar cartão de memorização do gabarito **atual**; a referência da tentativa histórica permanece intacta. O contexto da tarefa vinculada aparece ao final dos detalhes; `s` tenta atualizar os vínculos pela CLI oficial do Backlog.md. Ao criar/editar na TUI, a associação é tentada automaticamente, como nas outras interfaces.

Não há banco paralelo nem dependência nova para a TUI. O modo de entrada, cursor e tela anterior são restaurados ao sair normalmente, por Ctrl+C/SIGTERM/SIGHUP ou por erro capturado. Como em qualquer aplicação, encerramento forçado com SIGKILL não permite limpeza.

## CLI

Nos exemplos a seguir, `recall` representa a CLI. Use `recall-appimage` com a AppImage ou `node /caminho/Recall.md/bin/recall.js` com Node.js.

```bash
recall unit list
recall unit view RCL-1
recall unit edit RCL-1 --status "Praticando"
recall quiz RCL-1
recall answer RCL-1 --answers minhas-respostas.json
recall assess ID-DA-TENTATIVA --question fluxo --correct true
recall card from-question RCL-1 --question entrada
recall review --deck "Meu projeto" --due
recall review RCL-1 --card q-entrada --rating good
recall context RCL-1
recall sync
recall instructions
```

As respostas são um objeto JSON, por ID de questão. Alternativas usam índice **a partir de zero**:

```json
{"entrada": 0, "fluxo": "Minha explicação com minhas palavras."}
```

A CLI retorna JSON para operações estruturadas; `unit list --json` retorna a lista para automação. `unit view` e `quiz` omitem o gabarito. `unit import arquivo.json --id RCL-1` atualiza uma unidade, inclusive questões e cartões. Preserve os IDs para manter sua continuidade. Campos omitidos são preservados. Para criar várias fichas em ordem, importe um JSON com uma lista de objetos, sem `--id`. Se uma ficha falhar, a CLI indica a posição e quantas anteriores foram gravadas.

## IA e agentes

A primeira versão integra agentes por comandos e importação, sem SDK, conta ou provedor obrigatório. **Não há geração por IA embutida ou chamada automática a um modelo.** Um agente autorizado lê o material, segue `recall instructions`, propõe etapas/questões com fontes e usa `unit import` para criá-las. Veja [prompts e skills para agentes externos](AGENTS.md), [contrato para agentes](docs/agents.md) e [exemplo de importação](examples/primeira-etapa.json).

Cada questão tem fonte opcional para registrar arquivo, revisão, página ou documento. Revise material gerado antes de praticar. O produto não verifica por conta própria se uma afirmação corresponde à fonte indicada.

## Integração com Backlog.md

Correspondência por **mesmo caminho relativo e nome**, dentro da mesma pasta de estudo:

```text
backlog/tasks/back-12 - Autenticacao.md
recall/tasks/back-12 - Autenticacao.md
```

Crie a etapa com `--file 'back-12 - Autenticacao.md'`, informe o arquivo no formulário web ou no JSON de importação. Os IDs de aprendizagem e tarefa continuam independentes. Também são aceitas subpastas simétricas.

Ao criar/editar pela CLI ou web, ou iniciar `recall browser`, Recall.md reconhece a correspondência e tenta criar os vínculos. `recall sync` repete a sincronização, inclusive para arquivos criados manualmente. Se a CLI do Backlog.md estiver ausente, a etapa é salva e aparece um aviso; o contexto continua legível. Reexecute `sync` após instalar/configurar a CLI. A web relê os arquivos a cada segundo enquanto visível e ao recuperar o foco, atualizando cards, estados, tentativas e decks sem recarregar a página. Ela não interrompe formulários, uma revisão em andamento nem um quiz com rascunho; alternar entre quiz, flashcards e material preserva o rascunho até o envio. Quando a atualização externa não puder substituir o detalhe com segurança, ela é adiada até a próxima reabertura segura. Na aba Quiz, “Conferir suas tentativas anteriores”, ao lado de “Conferir respostas”, abre a aba Tentativas da etapa; o histórico fica nessa aba e o rascunho é preservado ao voltar ao Quiz.

O link de retorno é registrado pelo comando oficial:

```bash
backlog task edit BACK-12 --add-ref 'recall/tasks/back-12 - Autenticacao.md' --plain
```

Backlog.md conserva seus dados e referências; Recall.md não edita o Markdown da tarefa diretamente. O endereço da tarefa é registrado nos metadados `backlog` da unidade. Por padrão o executável é `backlog`; se necessário defina seu caminho absoluto em `recall/config.yml`:

```yaml
version: 1
name: Meu estudo
backlogCommand: /caminho/node_modules/.bin/backlog
```

Na web, o painel mostra ID, título, descrição, status, critérios de aceite expansíveis e link para o Markdown original servido pelo Recall.md. A descrição é exibida como texto seguro, preservando quebras de linha; não há renderização de HTML embutido. O contexto é lido da origem ao abrir a etapa, não de uma cópia congelada.

Limites: a versão inicial usa as raízes `backlog/tasks` e `recall/tasks`; não busca outros repositórios, branches ou arquivos arquivados. IDs duplicados impedem a vinculação. Tarefa removida ou renomeada fica indisponível até reconciliar os caminhos; não há migração automática. Se o mesmo caminho passar a conter outro ID, a associação é recusada. Links não sincronizam status, conteúdo ou respostas. Renomear uma unidade já existente não é suportado pela CLI inicial.

## Sessões de estudo na web

Abrir uma etapa ou iniciar prática começa uma sessão compartilhada entre abas do mesmo projeto/browser/endereço. O painel global à direita acompanha o registro e pode ser recolhido pelo relógio. Navegação, scroll e digitação contam como interação; polling e segundo plano não renovam o prazo de atividade.

Só o card aberto visível acumula tempo: reaberturas somam e, com **10 segundos acumulados**, todo o tempo e as ações entram no registro. Quiz e flashcards dentro dele têm somente hora transacional, sem duração individual. Flashcards estudados fora de uma etapa acumulam seu próprio tempo com o mesmo limiar. O tempo do deck une intervalos sobrepostos, sem exigir igualdade com a soma de seus cards.

**Encerrar sessão** no painel oferece salvar ou descartar. Após mais de uma hora sem interação, a sessão anterior é encerrada na última interação; ao atingir oito horas, encerra automaticamente, mantendo a confirmação antes de gravar. Fechar etapa ou trocar abas não salva isoladamente. Descartar o estudo não desfaz respostas, revisões ou alterações já salvas no material.

Registros confirmados aparecem em **Sessões de estudos** e **Tempo de estudo**, com tempo por deck/card, quantidades de aberturas/fechamentos derivadas dos horários e links de retorno. Cada sessão ocupa um único JSON minificado em `recall/sessions/`; rascunhos ficam no navegador. Sem armazenamento IndexedDB disponível, o registro não funciona; o restante do estudo permanece disponível. O recurso não comprova aprendizagem e não publica dados automaticamente. Veja o [formato](docs/format.md).

Ensaio Chrome com duas abas e material sintético: `node scripts/smoke-study-browser.mjs`. Ele cobre limiares, confirmação/descarte, retry, JSON compacto, navegação e flashcard independente; limites longos usam relógio controlado.

## Dados e revisão

```text
recall/
  config.yml
  tasks/*.md         # descrição em Markdown; questões e cartões no YAML
  attempts/*.md      # tentativas com referência, resposta e versão da unidade
  assessments/*.md   # autoavaliações de texto; cada avaliação é um novo evento
  reviews/*.md       # avaliações da recordação e próxima data
```

Veja [formato e exemplos](docs/format.md). Esses arquivos podem ser versionados com Git e inspecionados sem executar o produto. Todos os comandos usam os dados do estudo local. A web também guarda progresso de leitura em SQLite dentro de `recall/`.

A agenda é simples: **Repetir** em 10 minutos; **Difícil** em 1 dia; **Lembrei** em pelo menos 2 dias, dobrando o intervalo; **Fácil** em pelo menos 4 dias, triplicando o intervalo. Alterar frente/verso recoloca o cartão na fila de novos conteúdos, preservando o histórico anterior. Não é uma implementação de FSRS nem uma alegação de eficácia pedagógica validada.

## Desenvolvimento com recarregamento automático

Com dependências instaladas, execute `node --watch bin/recall.js --cwd /caminho/do/estudo browser --dev-reload`. Mudanças nos módulos reiniciam o servidor; alterações em arquivos HTML/JS/CSS de `web/`, incluindo salvamento por substituição, recarregam a página. O servidor fecha conexões SSE ao encerrar. Sem `--dev-reload`, esse mecanismo fica desativado; a atualização dos dados de estudo continua funcionando.

No modo de desenvolvimento, o rascunho do quiz fica no `sessionStorage` da aba, isolado por projeto/unidade. Após reload, a unidade, aba e respostas de questões que continuam iguais são restauradas. Questões alteradas/removidas são descartadas e envio bem-sucedido limpa o rascunho. Não são geradas tentativas automaticamente. Exige armazenamento de sessão disponível; fechar a aba pode descartar esse rascunho e outros formulários não são restaurados.

Ensaio de desenvolvimento em Chrome e cópia temporária do produto: `node scripts/smoke-dev-browser.mjs /caminho/gmr-planning/abrir-recall.sh`. O script testa substituições consecutivas, reinício do servidor, rascunhos e encerramento com SSE aberto, sem modificar o checkout original ou histórico pessoal.

## Verificar

```bash
npm run check
npm test
# Ensaio opcional com Backlog.md instalado; sempre usa pasta temporária:
RECALL_BACKLOG_BIN=/caminho/do/backlog npm test
# Chrome real, com dados sintéticos temporários:
node scripts/smoke-web-browser.mjs /caminho/do/chrome
```

Testes incluem controlador da TUI e um ensaio em pseudo-terminal POSIX real (requer Python 3) com redimensionamento, navegação, formulário, quiz, revisão, Ctrl+C/SIGTERM e restauração dos atributos do terminal, além de cinco ensaios DOM dos formulários, quiz, autoavaliação, persistência, alternância de abas com rascunho, atualização ao vivo e revisão da web. Também cobrem histórico, conflitos, CLI, HTTP e integração idempotente com a CLI real do Backlog.md quando fornecida. O servidor escuta por padrão em `127.0.0.1`. O smoke no Chrome valida interação, persistência e alternância entre quiz e cartões. A revisão visual do layout é uma verificação separada.

Referência de produto: [Backlog.md](https://github.com/MrLesk/Backlog.md). Recall.md é uma implementação independente, sem importar seus módulos internos.

## Links da interface web

O plano selecionado, a ficha, a aba e a página de material têm URLs que
podem ser copiadas ou recarregadas. As telas de Arquivados, Cartões de memorização,
Histórico e Cronogramas também têm rotas próprias. O botão Voltar do
navegador acompanha a navegação. Rascunhos de edição e confirmações são
temporários.

## Material de estudo na web

Abra uma ficha e use **Editar material** para cadastrar páginas, seções e
anexos. Imagens e vídeos reconhecidos aparecem no fim da página. Vídeos do
YouTube, Vimeo e Dailymotion usam seus próprios players. Vídeos por URL
direta usam o player do navegador. O material preserva um link para a fonte.

O indicador conta páginas visitadas e retoma a última página aberta.
O progresso é guardado no navegador e gravado em
`recall/reading-progress.sqlite` após dez minutos. Na agenda compartilhada,
ajuste os minutos de leitura por domínio. A estimativa da ficha inclui
páginas, links de leitura e a média da amostra de vídeos. A aba **Material**
mostra o tempo previsto e o realizado para a ficha.

## Cronogramas na web

A tela **Cronogramas** mostra a agenda acima da lista quando há cronogramas.
Use a engrenagem para editar as configurações gerais e **Sessões** para acompanhar
e confirmar estudos. Em **Novo cronograma**, a primeiro passo mostra a agenda
compartilhada já preenchida. No passo **Conteúdo**, selecione os planos de estudo ou capítulos e informe os minutos-base por ficha em cada linha. Informe nome, prioridade, início e prazo no último passo antes da revisão.
Se nenhum capítulo servir ao conteúdo, aplicar a prévia cria um capítulo com o
nome do cronograma. Use **Novo capítulo** ou o filtro de capítulos no quadro. Ao incluir
uma ficha em um plano de estudo agendado, selecione a fase a que ela pertence. Cada ficha do quadro é uma unidade de planejamento, com a própria estimativa.
No último passo antes da revisão, o Recall.md sugere um prazo ao encaixar o
esforço restante mais 50% de margem nas janelas regulares. Você pode informar
uma data diferente.
Em **Janelas semanais**, o modelo começa com 1 hora por dia, das 20h às 21h,
de segunda a sexta. Ajuste a duração, o início e os dias, aplique o modelo e
edite as janelas geradas. Use **Redefinir por um modelo** para substituí-las.
A tolerância semanal é registrada em horas e minutos e começa em 0 h 20 min
nas agendas novas. Revise o percentual de esforço que cabe até o prazo e o efeito nas
sessões antes de aplicar. O modal de revisão mostra o antes e o depois com
conexões entre horários alterados. Cada dia tem colunas **Antes** e **Depois**,
com totais de fichas e tempo de estudo. O Gantt cobre todas as datas até o
prazo, com navegação por intervalos. A folga pode ocupar até 50% do tempo de
estudo, em blocos de duração média de uma ficha, dentro das janelas livres.
A prévia tenta preservar as folgas dos outros
cronogramas e informa qualquer folga usada. Sessões realizadas aparecem em
verde-claro no dia efetivo, programadas em amarelo-claro e vencidas em
vermelho-claro até serem reprogramadas. No quadro, o filtro de sessão agendada lista as sessões pendentes em ordem de data e hora. **Pegar próxima ficha programada** abre a ficha pendente mais antiga entre as que passam pelos filtros.

Confirme sessões com o tempo real. O Recall.md usa a média das capítulos realizadas
nas próximas propostas e registra **Estudo concluído** quando todos os
fichas passam por **Em estudo**. A cobertura mede o encaixe do esforço
previsto. Quando a busca termina sem poder determinar a viabilidade, a prévia
exibe **Viabilidade não confirmada**.

Ao mover uma ficha planejada para **Em revisão** ou **Concluído**, ela
aparece em verde no cronograma como estudada no quadro. A
movimentação não registra duração nem cria uma sessão no histórico.

## Instalar `recall.md` com Docker

Requer Docker instalado e acessível ao usuário, Bash e curl. Funciona em Linux/macOS; no Windows, use WSL com integração Docker. Não requer clonar o repositório nem instalar Node.js:

```bash
curl -fsSL https://raw.githubusercontent.com/gmrodrigues/Recall.md/main/scripts/install-docker.sh | bash
```

O instalador baixa a imagem pública `ghcr.io/gmrodrigues/recall.md:latest` e cria `~/.local/bin/recall.md`, sem sudo. Se essa pasta ainda não estiver no PATH, adicione ao arquivo de configuração do shell:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Na pasta que deve guardar o estudo, use todos os comandos da CLI através de `recall.md`:

```bash
recall.md init
recall.md unit create --title "Entender o projeto" --deck "Arquitetura"
recall.md unit list
recall.md quiz RCL-1
recall.md review
recall.md tui
recall.md browser
# Outra porta local:
recall.md browser --port 6422
# Ajuda com os demais comandos, quizzes, importação e cartões de memorização:
recall.md --help
```

A web fica em `http://127.0.0.1:6421` (ou na porta escolhida), publicada somente no localhost. Ctrl+C encerra o contêiner. Em Docker rootless, o launcher usa a identidade do usuário do daemon para gravar na pasta montada. O launcher monta a pasta atual, preserva os arquivos `recall/` e usa seu UID/GID; TTY é ativado apenas quando entrada e saída são terminais. Execute a partir da pasta que contém os dados e os arquivos a importar; caminhos fora dessa pasta não ficam disponíveis no contêiner. Para estudar outro projeto, mude de diretório antes de executar `recall.md`.

### Atualizar

```bash
recall.md update
```

Atualiza a imagem Docker selecionada, sem alterar os materiais, respostas ou revisões. As próximas execuções usam a imagem baixada; reinicie uma web/TUI já aberta para usar a nova versão. Para atualizar também o launcher, execute novamente o comando de instalação. Ele preserva comandos existentes que não tenham sido criados por este instalador.

Para selecionar outra imagem na execução ou atualização:

```bash
RECALL_IMAGE=ghcr.io/gmrodrigues/recall.md:sha-<commit> recall.md unit list
RECALL_IMAGE=ghcr.io/gmrodrigues/recall.md:sha-<commit> recall.md update
```

### Diretório personalizado e remoção

```bash
curl -fsSL https://raw.githubusercontent.com/gmrodrigues/Recall.md/main/scripts/install-docker.sh | bash -s -- --bin-dir "$HOME/bin"
# Remover o launcher padrão, preservando os dados dos estudos:
rm "$HOME/.local/bin/recall.md"
```

Em uma cópia local, `sh scripts/install-docker.sh` faz a mesma instalação. O comando usa as mesmas limitações da imagem descritas abaixo, incluindo a integração opcional com Backlog.md. Para validar o instalador em diretórios temporários com Docker real: `python3 scripts/smoke-install-docker.py` (requer Python 3). O ensaio cobre pipe, instalação/reinstalação, atualização, CLI, argumentos, persistência, TUI em PTY, web local e proteção de comandos existentes.

## Docker / GHCR

Imagem pública no **GitHub Container Registry (GHCR)**: [`ghcr.io/gmrodrigues/recall.md:latest`](https://github.com/gmrodrigues/Recall.md/pkgs/container/recall.md).

Publicação inicial verificada em **14/11/2026**, com download sem credenciais:

| Referência | Endereço |
| --- | --- |
| Versão mais recente | `ghcr.io/gmrodrigues/recall.md:latest` |
| Tag da entrega inicial | `ghcr.io/gmrodrigues/recall.md:sha-4917012a5818a6f1175efef146851cc63a97756c` |
| Artefato imutável da entrega inicial | `ghcr.io/gmrodrigues/recall.md@sha256:c5e18d193efad447a3757efee608734d9714fcf430aa129e7028f71bf6304825` |

[Workflow da publicação inicial](https://github.com/gmrodrigues/Recall.md/actions/runs/43653578247). A tag `latest` acompanha novas publicações; use o digest acima para reproduzir exatamente esta entrega. Cada publicação também recebe `sha-<SHA completo do commit>`. A primeira versão da imagem é Linux/amd64.

Na pasta de estudo, inicialize os arquivos uma vez:

```bash
docker pull ghcr.io/gmrodrigues/recall.md:latest
docker run --rm --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$PWD,target=/workspace" \
  ghcr.io/gmrodrigues/recall.md:latest init
```

Abra a web:

```bash
docker run --rm --name recall --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$PWD,target=/workspace" \
  -p 127.0.0.1:6421:6421 \
  ghcr.io/gmrodrigues/recall.md:latest
```

Acesse **http://127.0.0.1:6421**. O comando padrão é `browser --host 0.0.0.0`: a aplicação escuta nas interfaces do contêiner e a porta é publicada apenas no localhost da máquina. O padrão fora do Docker continua sendo `127.0.0.1`. Outra porta local, como `-p 127.0.0.1:6422:6421`, também funciona. Ctrl+C encerra a web; os arquivos permanecem na pasta montada.

Para CLI e TUI:

```bash
docker run --rm --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$PWD,target=/workspace" \
  ghcr.io/gmrodrigues/recall.md:latest unit list

docker run --rm -it --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$PWD,target=/workspace" \
  ghcr.io/gmrodrigues/recall.md:latest tui
```

Os exemplos de UID/GID usam shell POSIX. A imagem usa o usuário `node` por padrão; `--user` permite gravar no diretório montado com a identidade do usuário local. O material não fica embutido na imagem. Monte a pasta que deve guardar `recall/`; sem essa montagem, arquivos criados no contêiner são efêmeros. Para projetos com Backlog.md, monte a pasta que contém as duas raízes. O contexto da tarefa pode ser lido, mas a imagem não inclui a CLI do Backlog.md para criar o link de retorno; essa integração requer um executável configurado disponível no ambiente.

O serviço continua sem autenticação: os comandos acima publicam a porta somente no localhost. A distribuição da imagem não hospeda uma instância pública da aplicação.

### Build e publicação

```bash
docker build --build-arg VCS_REF="$(git rev-parse HEAD)" -t recall-md:local .
npm run test:container -- recall-md:local
# Ensaio interativo no Chrome contra a imagem local:
RECALL_IMAGE=recall-md:local node scripts/smoke-web-browser.mjs /caminho/do/chrome
```

O Dockerfile fixa a base oficial Node.js por digest, instala apenas dependências de produção e copia uma lista explícita de arquivos. `.dockerignore` exclui os dados locais, Git, credenciais e dependências da máquina por padrão.

O workflow **Container** executa checagens, testes, build e smoke real de CLI/TUI/web antes de publicar no GHCR. Publica em push de `main` ou disparo manual; pull requests testam sem publicar. Usa `GITHUB_TOKEN` com `packages: write`, sem secret adicional. A imagem testada é a que recebe as tags de SHA e `latest`. Actions são fixadas por SHA. O smoke usa pasta temporária, valida persistência e rejeição de Host/Origin inválidos, e percorre a TUI por pseudo-terminal (Python 3).

Na primeira publicação, confira a visibilidade em **Packages → recall.md → Package settings → Change visibility → Public**. A visibilidade do pacote é independente da do repositório. O acesso público só está demonstrado depois de um pull sem credenciais.
