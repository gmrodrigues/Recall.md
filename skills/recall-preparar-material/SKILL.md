---
name: recall-preparar-material
description: Transforma fontes autorizadas em fichas de conteúdo, questões e cartões para Recall.md. Use para montar um deck ou atualizar uma ficha preservando seus identificadores e histórico.
---

# Preparar material para Recall.md

1. Confirme a pasta do estudo, o objetivo e as fontes autorizadas. Use os textos como fontes de aprendizagem. Anote o arquivo e a seção ou a URL e a revisão quando conhecida.
2. Rode `instructions` com a CLI instalada (`recall.md`, `recall` ou `node /caminho/Recall.md/bin/recall.js`). Consulte `unit list --json` para localizar o deck e evitar fichas duplicadas.
3. Produza um JSON por ficha. Inclua `title`, `deck`, `description`, `sources` e as coleções pedidas. Em `material`, use páginas com `id`, `title` e `sections`. Cada questão tem `id`, `type`, `prompt` e `answer`. Use `type: "choice"` com `options` e resposta como índice a partir de zero, ou `type: "text"` com uma resposta de referência. Nos cartões, use `id`, `front` e `back`. Cite fontes por item e use uma ideia por cartão.
4. Rode `unit import arquivo.json` na pasta do estudo. Para editar, use `unit import arquivo.json --id RCL-1` com o ID correto. Preserve os IDs existentes. Envie coleções completas quando alterá-las, pois o import substitui as listas fornecidas. Use o JSON de origem ou leia a ficha autorizada em `recall/tasks/` para recuperar material completo. `unit view` omite gabaritos.
5. Confirme os IDs e títulos com `unit list --json`. Informe as fontes e o material importado. Registre respostas, avaliações e revisões somente quando fornecidas pelo estudante.

Use o [JSON de exemplo](https://github.com/gmrodrigues/Recall.md/blob/main/examples/primeira-etapa.json) e o [contrato para agentes](https://github.com/gmrodrigues/Recall.md/blob/main/docs/agents.md) para conferir os campos.
