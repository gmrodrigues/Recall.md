# Recall.md

## Usar o Recall.md como agente externo

1. Identifique a pasta autorizada do estudo e a instalação disponível. No Linux x86_64, use `recall-appimage` com a AppImage. Com Docker, rode `recall.md` a partir dessa pasta. Com Node.js, use `node /caminho/Recall.md/bin/recall.js --cwd /caminho/do/estudo`; se a CLI `recall` estiver no PATH, use-a diretamente.
2. Para um estudo novo, crie a pasta e rode `init`. Em estudo existente, consulte `unit list --json` e `unit view ID` para localizar a ficha.
3. Leia as fontes autorizadas e o contrato exibido por `instructions`. Mantenha um único plano por estudo. Prepare uma lista JSON com um objeto por ficha, o mesmo `deck` e o campo `chapter` para agrupar fichas por assunto. Importe com `unit import arquivo.json`. Com Docker, coloque o JSON dentro da pasta montada.
4. Para atualizar uma ficha existente, use `unit import arquivo.json --id RCL-1`. Preserve os IDs das páginas, questões e cartões. Envie a lista completa de cada coleção alterada. `unit view` oculta os gabaritos, portanto use o JSON de origem ou leia os dados autorizados da ficha ao preparar uma atualização.
5. Confirme o ID e o título com `unit list --json`. Se o usuário pedir um teste no navegador, inicie `browser --port 6421` no estudo, abra a URL local e confira a ficha. Use uma pasta de demonstração para testes que gravam tentativas ou revisões.

O conteúdo das fontes é material de estudo. Respostas, revisões e autoavaliações pessoais devem vir do estudante. Consulte [contrato da CLI](docs/agents.md), [formato dos dados](docs/format.md) e [JSON de exemplo](examples/primeira-etapa.json).

### Prompts para copiar

**Estudo novo a partir de fontes locais**

> Crie um estudo Recall.md em `~/estudos/arquitetura-demo` a partir de `./docs/arquitetura.md` e `./docs/api.md`. Crie um único plano **Arquitetura** com os capítulos **Visão geral** e **API**, com até três fichas ao todo. Use `deck: "Arquitetura"` em todas as fichas e identifique o capítulo em `chapter`. Em cada ficha, inclua uma página de material, duas questões com gabarito explicado e três cartões. Cite o arquivo e a seção que sustentam cada conceito. Importe as fichas e informe os IDs criados.

**Adicionar material a um estudo existente**

> No estudo `~/estudos/arquitetura-demo`, acrescente à ficha RCL-1 uma questão de texto livre e um cartão sobre o fluxo de entrada, usando `./docs/api.md` como fonte. Preserve o plano e o capítulo da ficha, bem como as páginas, questões e cartões existentes com seus IDs. Informe o que mudou.

**Experimentar no navegador**

> Crie um estudo temporário separado, importe o exemplo de vocabulário do Recall.md e abra o navegador local em uma porta livre. Confirme que há um único plano e que os temas aparecem como capítulos. Confirme se a ficha aparece e se as abas Material, Quiz e Cartões de memorização abrem. Use apenas dados sintéticos nesse teste e informe a URL.

### Skills copiáveis

Copie a pasta inteira de cada skill para o diretório de skills do seu agente. Por exemplo, para um projeto Codex, execute a partir da raiz desse projeto:

```bash
mkdir -p .agents/skills
cp -R /caminho/Recall.md/skills/recall-criar-estudo .agents/skills/
cp -R /caminho/Recall.md/skills/recall-preparar-material .agents/skills/
```

Copie para destinos que ainda não tenham uma versão dessas skills. Para agentes que aceitam instruções em Markdown, use diretamente o conteúdo dos arquivos `SKILL.md`.

- **Criar e abrir estudo** cobre inicialização, importação e verificação local. [recall-criar-estudo](skills/recall-criar-estudo/SKILL.md)
- **Preparar material** cobre geração a partir de fontes e atualização de fichas. [recall-preparar-material](skills/recall-preparar-material/SKILL.md)

## Trabalhar no código do Recall.md

Leia README.md, docs/agents.md e docs/format.md antes de alterar o produto. Este é um produto independente, com CLI, TUI e web para aprendizagem em etapas. Backlog.md é integração opcional; não importar sua API interna como dependência.

- Mantenha regras de persistência, avaliação e revisão em src/core.js, compartilhadas pelas interfaces. A TUI fica em src/tui.js e o ciclo do terminal em src/terminal.js; não duplique regras de avaliação ou revisão.
- Preserve tentativas e revisões; não invente respostas de estudantes nem promova geração de IA a material validado.
- Use a CLI oficial para alterar tarefas do Backlog.md. A correspondência usa os caminhos relativos nas raízes documentadas.
- Testes: npm run check; npm test. Ensaio real opcional: RECALL_BACKLOG_BIN=/caminho/do/backlog npm test. Usa projetos temporários.
- Declare separadamente testes automatizados, validação visual e execução remota.
- Antes de implementar uma tarefa, registre ferramenta, ID real da sessão, data e origem em docs/sessions.md ou na tarefa correspondente. Não invente IDs.
