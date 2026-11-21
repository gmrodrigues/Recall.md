# Formato inicial — versão 1

`recall/config.yml` identifica o projeto e o comando opcional do Backlog.md. Uma etapa fica em `recall/tasks/<nome>.md`:

```markdown
---
id: RCL-1
title: Entender uma entrada
deck: Arquitetura
status: A estudar
sources:
  - src/entrada.js @ revisão identificada
questions:
  - id: entrada
    type: choice
    prompt: Quem traduz a entrada para o caso de uso?
    options:
      - Adaptador
      - Banco de dados
    answer: 0
    explanation: O adaptador faz a tradução da entrada.
cards:
  - id: papel-adaptador
    front: Qual é o papel de um adaptador de entrada?
    back: Traduzir a entrada para a chamada do caso de uso.
    deck: Arquitetura
---

# Material

Acompanhe uma chamada do adaptador até o domínio.
```

O corpo inteiro após o frontmatter é a descrição. Chaves adicionais de metadados de uma unidade existente são preservadas nas edições pela aplicação; questões e cartões seguem o esquema documentado. Não coloque campos chamados `file`, `description` ou `version` no YAML: são propriedades derivadas/reservadas pela aplicação. IDs de unidades devem ser únicos no projeto. Para alocação de IDs e gravação consistente, prefira os comandos da CLI; edições externas exigem cuidado com o esquema.

Tentativas contêm `unit`, `version` (SHA-256 do Markdown usado naquele momento) e `results`, com enunciado, resposta enviada, referência, explicação e resultado. Texto livre começa com `correct: null`; avaliações ficam em eventos separados com método `self`. Cada tentativa guarda sua referência e enunciado mesmo após a unidade mudar. Não altere os eventos anteriores.

Revisões referenciam unidade, cartão e versão do conteúdo do cartão (frente/verso), além de avaliação, intervalo e próxima data. A revisão avalia recordação declarada, não compreensão demonstrada. A origem dos dados é o conjunto de arquivos, sem projeção paralela em banco de dados.

## Simetria

A associação inicial usa o caminho relativo exato abaixo das duas raízes fixas. O ID externo só é lido depois da correspondência, e duplicidade de ID impede a escrita. O Recall guarda `backlog: {id, file}`; a tarefa conserva `references` contendo `recall/tasks/<caminho>`, adicionada pela CLI do Backlog.md. Após renomeações, reconciliar manualmente os caminhos/referências: esta versão não tenta adivinhar a nova identidade nem remove links antigos automaticamente.

## Gravação

Mutações do Recall usam um lock local `recall/.write-lock` e troca atômica do arquivo da unidade. Eventos usam nomes UUID e criação exclusiva. Interrupção forçada pode deixar o lock: só o remova manualmente após confirmar que não há uma operação de gravação ativa. Edição externa não participa desse lock. A edição web envia a versão lida para detectar conflito com alteração de conteúdo; uma falha de vínculo não desfaz a etapa já salva, e pode ser resolvida com `recall sync`.

## TUI

A interface de terminal usa o mesmo formato de arquivos e Store das demais interfaces. Não persiste seleção de tela, rascunho de formulário nem respostas de quiz antes do envio completo; Esc descarta apenas o rascunho. Tentativas e revisões já enviadas seguem imutáveis. Comparação de versão impede envio de quiz ou avaliação de cartão contra conteúdo alterado durante a sessão.

## Cronograma de estudo

A web grava a agenda em `recall/schedule.json` (versão 2). Projetos sem esse arquivo
começam com agenda, marcos e histórico vazios. O arquivo guarda a disponibilidade
semanal, os cronogramas, as sessões propostas já aplicadas e as confirmações. Uma
referência de estudo usa o ID da etapa do quadro (`card.kind: unit`). Sessões guardam o início e o
fim em minutos desde a época Unix, além da data local usada no encaixe. O histórico
também guarda o horário de confirmação, os minutos previstos e os reais.
A disponibilidade registra `overtimeHours` e `overtimeMinutes` separadamente,
com minutos de 0 a 59. A leitura da versão 1 converte o total antigo para horas
e minutos. A próxima gravação da agenda persiste a versão 2.

Cronogramas novos podem guardar `minutes` em cada grupo de conteúdo. Esse
valor estima o tempo-base por ficha do plano ou capítulo correspondente.
Cronogramas antigos continuam aceitando estimativas nos capítulos gravados.

A prévia pertence à revisão da agenda e do catálogo de etapas que a originou.
A aplicação substitui a distribuição em uma gravação atômica. Alterar janelas,
marcos, seleções ou confirmações requer uma nova prévia se houver outra aberta.


Fases de cronogramas novos guardam o ID de seu milestone. Na criação, se o
conteúdo não tiver um milestone disponível, a confirmação da prévia grava
um marco com o nome do cronograma e as etapas selecionadas. Etapas novas em
decks agendados guardam o vínculo em `milestoneId` no Markdown da unidade.
Marcos armazenam IDs de etapas em `units`. A leitura resolve referências antigas
a flashcards pela etapa de origem. Sessões pendentes antigas seguem a estimativa
da etapa e as confirmações antigas permanecem no histórico.


`rests` guarda os blocos de folga calculados, com `scheduleId`, data e início/fim
em minutos desde a época Unix. O motor encaixa blocos de até a média por etapa,
usando janelas regulares desocupadas e até metade do esforço previsto. A prévia
compara esses blocos com as sessões propostas para avisar sobre o uso de folgas.

`statusChangedAt` registra a última mudança de coluna no Markdown da unidade.
A API projeta estudo concluído do Kanban em `workflowCompletions`, sem persistir
esses itens em `confirmations` nem usar a passagem de coluna para calcular médias.


## Decks do quadro

`recall/decks.json` guarda a ordem e o estado dos decks gerenciados no menu.
Projetos sem esse arquivo descobrem os decks pelos nomes gravados nas etapas
e nos flashcards. Um deck recém-criado pode ficar vazio. Arquivar oculta suas
etapas, flashcards, tentativas e agenda das áreas de estudo. Desarquivar torna
esses dados visíveis novamente. Se a agenda ativa ocupou um horário antigo
durante o arquivamento, a sessão conflitante precisa ser reprogramada.

Remover um deck registra sua remoção do Recall.md e preserva os arquivos
locais. O deck removido também sai da lista de arquivados. A remoção de um
cronograma libera suas sessões exclusivas e folgas. As etapas, as sessões
compartilhadas que ainda pertencem a outros cronogramas e as confirmações de
estudo são preservadas.

## Material com páginas e progresso

O frontmatter de uma etapa pode conter `material`, uma lista de páginas com
ID estável, título e seções. Cada seção tem título, texto e links opcionais.

```yaml
material:
  - id: material
    title: Introdução
    sections:
      - title: Referências
        text: Veja o vídeo ao fim desta página.
        links:
          - url: https://www.youtube.com/watch?v=dQw4w9WgXcQ
            type: auto
            label: Vídeo de referência
```

O campo `type` aceita `auto`, `link`, `image` e `video`. A descrição antiga
continua no corpo Markdown. Quando não há páginas cadastradas, o leitor
apresenta a descrição como uma página padrão. O ID `material` continua
identificando essa primeira página se ela for editada.

As páginas visitadas e a última página aberta são gravadas em
`recall/reading-progress.sqlite`. O navegador mantém as alterações no
armazenamento local até o envio após dez minutos. A gravação combina páginas
visitadas entre abas e conserva a posição mais recente. Uma visita ao
material não registra minutos realizados nem altera o estado da etapa.

Na agenda, `linkMinutesByDomain` guarda as médias por domínio que diferem dos
cinco minutos padrão. O cronograma pode guardar `videoAverageSeconds` e
`videoSampleCount`, bem como `studyEstimates` por etapa. A proposta soma
estimativa-base, cinco minutos por página cadastrada, minutos de links de
leitura e duração média dos vídeos multiplicada pela quantidade de vídeos.
Links, vídeos e imagens têm classificações mutuamente exclusivas para a
estimativa. O navegador tenta obter a duração de até cinco vídeos escolhidos
ao acaso. A média exclui valores atípicos pelo desvio absoluto mediano quando
há ao menos três amostras. As confirmações locais em `schedule.json`
guardam os minutos previstos e realizados e alimentam a próxima estimativa,
com o mesmo filtro de valores atípicos. Os valores confirmados permanecem no
histórico.

## Leituras externas do material

A tabela `external_material_reads` em `recall/reading-progress.sqlite` grava
o início e a confirmação de uma leitura externa. O identificador é o SHA-256
da URL normalizada. Fragmentos de página são ignorados na identidade e
links reconhecidos de um mesmo vídeo podem compartilhar o endereço de seu
player. Referências repetidas mostram a primeira conclusão e a duração
correspondente. A confirmação grava o tempo imediatamente. O indicador de
páginas visitadas mantém seu próprio buffer de dez minutos.

As anotações ficam associadas ao mesmo hash da leitura externa. A distribuição
da pilha segue a ordem de gravação. Cada nota guarda texto de até 1024
caracteres ou uma imagem PNG, JPEG, GIF ou WebP de até 512 KB. Colar uma imagem da área de transferência entre trechos gera notas separadas. Ao concluir a leitura, a
gravação das notas e da conclusão é atômica. Pelo material, é possível
remover as notas gravadas.

Perguntas e cartões criados a partir de uma anotação guardam o campo
`noteOrigin`, com o `id` da nota e o `hash` do link. Se a nota for removida,
o vínculo continua registrado e a interface informa que a origem foi removida.

Ao escolher **Não concluí**, as anotações também são gravadas sob o hash
do link. A leitura permanece pendente e o tempo de conclusão só é gravado
ao escolher **Concluí**.
