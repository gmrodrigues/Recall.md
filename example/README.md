# Exemplo: curso de inglês americano

Espaço de estudo pronto. Cinco etapas no deck **Inglês americano**, com material em português, grafia e vocabulário dos Estados Unidos, questões e flashcards. O conteúdo é original deste repositório. Não há tentativas nem revisões de estudante.

| Etapa | Assunto |
| --- | --- |
| RCL-1 | Cumprimentar no dia a dia |
| RCL-2 | Apresentar-se |
| RCL-3 | Palavras e grafia dos Estados Unidos |
| RCL-4 | Pedir com educação |
| RCL-5 | Perguntas no presente |

Copie esta pasta antes de estudar. Respostas e revisões ficam em `recall/` e não devem ir para o repositório do produto.

```bash
cp -a example ~/estudo-ingles
cd ~/estudo-ingles
node /caminho/Recall.md/bin/recall.js unit list
node /caminho/Recall.md/bin/recall.js quiz RCL-1
node /caminho/Recall.md/bin/recall.js tui
node /caminho/Recall.md/bin/recall.js browser
```

A web abre em http://127.0.0.1:6421. O estado inicial de cada etapa é **A estudar**. A conclusão usa o kanban e a revisão que já existem.
