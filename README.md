# Painel do Gestor — Use Arcanju

Sistema de gestão da Use Arcanju. A V1 cobre o Financeiro: lançamentos, projeção diária,
simulador de ofertas, CMV, frete, canais, campanhas, caixa e reserva, custo da falha,
metas e agenda de pagamentos. Os demais departamentos já estão previstos na arquitetura.

Princípio: **você informa pouco, o sistema calcula, projeta, diagnostica e ajuda a decidir.**

---

## O que tem dentro

| Arquivo | Para que serve |
|---|---|
| `index.html` | O painel inteiro. Um arquivo só: HTML, CSS e JavaScript. |
| `middleware.js` | Pede a senha no servidor antes de entregar qualquer coisa. |
| `api/vendas.js` | Pedidos pagos da Nuvemshop. |
| `api/ads.js` | Gasto, compras e receita por campanha na Meta. |
| `api/frete.js` | Custo real de envio por pedido, vindo da Nuvemshop. |
| `api/_lib.js` | Funções compartilhadas pelas três rotas. |
| `vercel.json` | Configuração da hospedagem. |
| `.env.example` | Lista das variáveis de ambiente (os valores ficam só na Vercel). |

Os dados do painel ficam salvos no navegador de quem usa (localStorage). Não há banco de dados
ainda — o código foi escrito com uma camada `Store` isolada justamente para trocar isso depois
sem refazer o resto. Faça backup em Configurações de tempos em tempos.

---

## Passo 1 — Subir para o GitHub

Arraste todos os arquivos deste pacote para o repositório, mantendo a pasta `api/` como pasta.
A estrutura precisa ficar assim:

```
index.html
middleware.js
vercel.json
.env.example
.gitignore
api/
  _lib.js
  vendas.js
  ads.js
  frete.js
```

## Passo 2 — Publicar na Vercel

1. Vercel → **Add New → Project** → importe o repositório.
2. Framework Preset: **Other**. Não precisa de build nem de comando de instalação.
3. **Deploy**.

## Passo 3 — Variáveis de ambiente

Em **Settings → Environment Variables**, adicione uma a uma (marque Production e Preview):

| Nome | Valor |
|---|---|
| `PAINEL_USUARIO` | `arcanju` |
| `PAINEL_SENHA` | a senha de acesso ao painel |
| `APP_KEY` | qualquer texto longo, inventado por você |
| `NUVEMSHOP_STORE_ID` | o número da loja (aparece na URL do admin) |
| `NUVEMSHOP_TOKEN` | o access token do seu app |
| `META_AD_ACCOUNT_ID` | `act_` + o ID da conta de anúncios |
| `META_TOKEN` | token de acesso da Meta |

Depois de salvar, clique em **Redeploy**. Variável nova só vale no próximo deploy.

## Passo 4 — Onde pegar cada credencial

**Nuvemshop**
O ID da loja aparece na URL do admin. O token vem do app que você já criou:
o app precisa ter a permissão de leitura de pedidos (`read_orders`). Se o token não
funcionar, refaça a autorização do app pela própria Nuvemshop.

**Meta**
No Gerenciador de Anúncios, o ID da conta aparece no seletor de contas (começa com `act_`).
O token sai do [Meta for Developers](https://developers.facebook.com/): crie um app,
adicione o produto Marketing API e gere um token com a permissão `ads_read`.
Tokens curtos expiram em horas — gere um **token de longa duração** ou um token de usuário
do sistema, senão o painel para de buscar sozinho depois de um dia.

**Frete**
Já vem da Nuvemshop, no campo do custo que a loja paga por pedido. Não precisa de outra
integração. Se depois você quiser o número da transportadora em vez do da loja, é só trocar
o conteúdo de `api/frete.js` — o painel não muda.

## Passo 5 — Ligar no painel

Abra o painel publicado → **Integrações**:

1. Endereço do conector: `/api`
2. Chave de acesso: o mesmo texto que você pôs em `APP_KEY`
3. Deixe marcado "buscar sozinho toda vez que eu abrir"
4. **Salvar conector** → **Testar conexão**
5. Em cada fonte, clique em **Trazer 12 meses** para preencher o histórico

Cada pedido tem um identificador próprio. Sincronizar o mesmo mês de novo **atualiza** os
registros, não duplica.

---

## Sobre segurança

A senha digitada dentro do painel é só uma primeira barreira: ela vive no arquivo que o
navegador baixa, então não protege contra quem sabe abrir o código-fonte. A proteção real é o
`middleware.js`, que confere usuário e senha no servidor da Vercel antes de entregar qualquer
arquivo — inclusive as rotas do conector. Configure `PAINEL_SENHA` e ela passa a ser pedida
pelo próprio navegador, antes do painel carregar.

Os tokens da Nuvemshop e da Meta nunca saem da Vercel. O navegador só conversa com `/api`.

---

## Custos: onde mudar, e por que existe vigência

Tudo que muda quando você troca de fornecedor está em **Configurações → Custos e taxas**:
custo da camiseta e quem fornece, kit de embalagem por tamanho do pedido, frete médio,
gateway (percentual e taxa fixa), checkout, imposto e o cenário-base de marketing.
Enquanto você digita, o painel mostra o efeito na oferta principal, em reais por pedido.

Cada alteração é salva com um **mês a partir do qual passa a valer**. Meses anteriores
continuam com os custos da época — se a camiseta subir de R$ 15 para R$ 19 em junho, o
resultado de março não muda. O histórico de alterações fica logo abaixo, e dá para remover
uma vigência se ela foi cadastrada errado.

Valores que não dependem de fornecedor — saldo inicial, custo fixo mensal, meses de reserva,
margem alvo, camisetas por pedido — ficam no cartão seguinte e valem para tudo.

Premissas de partida já carregadas: camiseta R$ 15, kit R$ 9,15 (até 3 peças) e R$ 13,55
(4 peças), frete R$ 18, Appmax 4,88% + R$ 0,99 por pedido, Nuvemshop 0,7%, imposto 6,7%,
marketing 29%, custo fixo mensal R$ 7.690,90.

## Lançamentos manuais

Continuam disponíveis e sempre estarão: o botão **Novo lançamento** aceita qualquer receita ou
despesa. A automação cobre as entradas e o tráfego; as saídas do dia a dia você lança, e as
fixas ficam cadastradas na Agenda de pagamentos, aparecendo sozinhas todo mês.
