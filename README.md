# compras

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

## Dados e recuperação

Compras movidas para a lixeira deixam de aparecer nos históricos, indicadores e preços. É possível restaurá-las por 30 dias; depois desse prazo, a compra, seus itens e os preços associados são removidos permanentemente. O estoque é descontado ao mover a compra para a lixeira e reposto ao restaurá-la. O histórico de compras é separado do formulário de registro e permite consultar os detalhes completos de cada compra.

O registro de compras inclui estabelecimento, forma de pagamento e categoria dos produtos, além de sugerir estabelecimentos já usados. As compras existentes são preservadas pela migração; compras antigas sem essa informação exibem a forma de pagamento como não informada. As conferências de estoque continuam respeitando a preferência de histórico já salva, preservando configurações existentes. Em Configurações, a opção de salvamento automático controla as quantidades reais digitadas no Estoque: quando ativada, uma quantidade válida é salva ao confirmar o campo ou sair da tela; quando desativada, o app avisa antes de descartar alterações pendentes.

Na tela de Estoque, produtos podem ser selecionados e excluídos permanentemente em lote após uma confirmação explícita. A exclusão remove os registros de conferência, os itens correspondentes nas compras e o histórico de preços; os registros gerais das compras e seus totais são mantidos.

As alterações do banco são migradas automaticamente no arquivo existente `compras.db`: compras recebem um marcador de exclusão e as preferências ficam em uma tabela própria, sem remover os dados atuais.
