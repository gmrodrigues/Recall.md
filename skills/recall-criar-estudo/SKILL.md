---
name: recall-criar-estudo
description: Cria um estudo independente no Recall.md, importa uma ficha e abre ou verifica a interface web local. Use para iniciar um estudo em uma pasta separada ou testar um percurso sintético.
---

# Criar estudo no Recall.md

1. Escolha a pasta solicitada para o estudo. Para ensaios que gravam dados, crie uma pasta temporária exclusiva. O aplicativo grava `recall/` dentro da pasta selecionada.
2. Use a instalação do usuário. No Linux x86_64, a AppImage fornece `recall-appimage`. Com Docker, entre na pasta do estudo e use `recall.md`. Com Node.js, use `node /caminho/Recall.md/bin/recall.js --cwd /caminho/estudo`. Para instalar, consulte o início do [README do Recall.md](https://github.com/gmrodrigues/Recall.md#instalar-e-abrir-um-estudo-independente).
3. Rode `init` em um estudo novo. Use um único plano por estudo. Separe os temas em capítulos e mantenha o mesmo `deck` em todas as fichas da lista JSON. O campo `chapter` indica o capítulo da ficha. Para testar essa estrutura, baixe o [exemplo de vocabulário](https://raw.githubusercontent.com/gmrodrigues/Recall.md/main/examples/example-vocabulario/vocabulario-ingles.json) para a pasta do estudo.
4. Rode `unit import vocabulario-ingles.json` e confirme os IDs com `unit list --json`. Um novo import sem `--id` cria outra ficha.
5. Rode `browser --port 6421` e abra `http://127.0.0.1:6421`. Use outra porta livre se necessário. No Quadro de estudos, confira o plano, o filtro de capítulo e as abas Material, Quiz e Cartões de memorização de uma ficha. Distinga verificação HTTP de navegação realmente exercitada.
6. Informe pasta, ID, URL e se o servidor ficou ativo. Encerre o servidor quando ele servir somente a um teste temporário e o usuário não precisar acessá-lo.
