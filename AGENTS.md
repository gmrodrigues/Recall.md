# Recall.md

Leia README.md, docs/agents.md e docs/format.md antes de alterar o produto. Este é um produto independente, com CLI, TUI e web para aprendizagem em etapas. Backlog.md é integração opcional; não importar sua API interna como dependência.

- Mantenha regras de persistência, avaliação e revisão em src/core.js, compartilhadas pelas interfaces. A TUI fica em src/tui.js e o ciclo do terminal em src/terminal.js; não duplique regras de avaliação ou revisão.
- Preserve tentativas e revisões; não invente respostas de estudantes nem promova geração de IA a material validado.
- Use a CLI oficial para alterar tarefas do Backlog.md. A correspondência usa os caminhos relativos nas raízes documentadas.
- Testes: npm run check; npm test. Ensaio real opcional: RECALL_BACKLOG_BIN=/caminho/do/backlog npm test. Usa projetos temporários.
- Declare separadamente testes automatizados, validação visual e execução remota.
- Antes de implementar uma tarefa, registre ferramenta, ID real da sessão, data e origem em docs/sessions.md ou na tarefa correspondente. Não invente IDs.

## Roadmap

Entregar nesta ordem. Cada fase fica utilizável antes da seguinte. A interface continua em português; o inglês entra ao lado, no mesmo controle, para a pessoa ver as duas línguas juntas.

### 1. Organização das traduções

Criar um catálogo único da interface, com uma entrada por texto fixo: identificador estável, português e inglês. Web, TUI e mensagens fixas da CLI leem esse catálogo. O servidor publica o mesmo arquivo para o browser; não manter uma segunda lista em `web/`.

Entram menus, botões, rótulos, placeholders, títulos de tela, ajuda da TUI, estados exibidos e mensagens fixas. Ficam de fora o material do estudante, títulos de etapas, decks, questões, cartões, tentativas, revisões e chaves do formato. O valor gravado dos estados continua `A estudar`, `Estudando`, `Praticando`, `Em revisão` e `Concluído`; a tradução só muda o que a pessoa lê.

### 2. Português e inglês ao mesmo tempo

Com o inglês ligado, cada item de interface mostra o português e, na mesma linha ou logo abaixo, o inglês. Um botão continua sendo um botão. O nome acessível permanece o português, para o controle não ser anunciado duas vezes.

A ordem visual é sempre português e depois inglês. Não há modo só em inglês nesta entrega.

### 3. Ligar e desligar o inglês

A preferência fica em `recall/config.yml`, vale para CLI, TUI e web do mesmo espaço de estudo e sobrevive a reinícios. O controle aparece na web e na TUI.

Espaço novo começa com o inglês ligado. Configuração antiga sem a chave permanece só em português até a pessoa ligar. Desligar esconde o inglês e deixa o português completo; ligar não regrava tarefas, tentativas nem revisões.

### 4. Diretório de exemplo embutido

Incluir no produto um diretório de estudo pronto, copiado pela imagem Docker junto com o restante da lista explícita. Um comando da CLI cria um espaço novo a partir desse diretório quando a pasta de destino ainda não tem `recall/`. O exemplo sintético `examples/primeira-etapa.json` continua disponível para importação avulsa.

### 5. Curso embutido de inglês americano

O diretório de exemplo é um curso curto de língua inglesa americana, no formato já existente de etapas, questões e flashcards. A pessoa abre o espaço e estuda sem redigir o material.

O curso usa grafia e vocabulário dos Estados Unidos e traz, em português, a explicação necessária para estudar. Cada etapa tem objetivo, material, questões de múltipla escolha ou texto e cartões. O conteúdo é original deste repositório. A conclusão do curso usa os estados e a revisão que já existem; não cria nota mínima nem agenda nova.

### 6. Checagem de segredos antes do commit

Criar um script Python 3.12 que o agente executa antes de qualquer commit. Ele confere se o que seguiria para o commit, e portanto para um push, contém chave, senha, secret key ou API key. O script só verifica e encerra; não altera arquivos, não faz commit e não faz push.

A leitura obedece ao `.gitignore`: arquivo ou diretório ignorado fica de fora, inclusive regras herdadas e negações. Entra o que o Git gravaria no commit, o índice preparado e as alterações de arquivos já rastreados. Um arquivo ignorado que tenha sido forçado para o índice também entra. `.git` fica de fora.

O script procura blocos de chave privada, atribuições de senha, `secret key` e tokens de API em formatos conhecidos, como chaves de fornecedor e prefixos de token. A saída lista caminho e tipo do achado, sem imprimir o segredo. Saída 0 significa que a verificação passou; qualquer outro código impede o commit. Um teste automático cobre um segredo sintético encontrado, um arquivo ignorado deixado de lado e um diretório limpo aprovado.
