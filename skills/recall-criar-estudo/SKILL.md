---
name: recall-criar-estudo
description: Cria um estudo independente no Recall.md, importa uma ficha e abre ou verifica a interface web local. Use para iniciar um estudo em uma pasta separada ou testar um percurso sintético.
---

# Criar estudo no Recall.md

1. Escolha a pasta solicitada para o estudo. Para ensaios que gravam dados, crie uma pasta temporária exclusiva. O aplicativo grava `recall/` dentro da pasta selecionada.
2. Use a instalação do usuário. Com Docker, entre na pasta do estudo e use `recall.md`. Com Node.js, use `node /caminho/Recall.md/bin/recall.js --cwd /caminho/estudo`. Para instalar, consulte o início do [README do Recall.md](https://github.com/gmrodrigues/Recall.md#instalar-e-abrir-um-estudo-independente).
3. Rode `init` em um estudo novo. Para um teste, use o [exemplo sintético](https://raw.githubusercontent.com/gmrodrigues/Recall.md/main/examples/primeira-etapa.json). Salve uma cópia na pasta do estudo se estiver usando Docker.
4. Rode `unit import primeira-etapa.json` e confirme o ID com `unit list --json`. Um novo import sem `--id` cria outra ficha.
5. Rode `browser --port 6421` e abra `http://127.0.0.1:6421`. Use outra porta livre se necessário. No Quadro de estudos, confira a ficha e as abas Material, Quiz e Cartões de memorização. Distinga verificação HTTP de navegação realmente exercitada.
6. Informe pasta, ID, URL e se o servidor ficou ativo. Encerre o servidor quando ele servir somente a um teste temporário e o usuário não precisar acessá-lo.
