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
| `api/expedicao.js` | Pedidos pagos com os itens, para a Logística separar e postar. |
| `lazarus.html` | Projeto Lazarus. Roda separado, dentro do painel. |
| `producao.html` | Portal da equipe de produção, com entrada por PIN. |
| `api/producao.js` | Ordens de serviço, equipe, guia e avisos do portal (Upstash Redis). |
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
lazarus.html
producao.html
api/
  _lib.js
  expedicao.js
  producao.js
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

## Detalhes do conector da loja

**Receita.** O painel usa `total − frete cobrado`, nunca o `subtotal` da Nuvemshop. O subtotal
vem antes do desconto: num pedido promocional de R$ 179 formado por três peças de R$ 71, o
subtotal é R$ 213. Usá-lo faria o painel registrar receita que nunca entrou.

**Contagem de peças.** Capelinha, sacolinha, saquinho, cartinha, cheirinho, brinde e adesivo
não são contados como camiseta — senão cada brinde viraria mais uma peça multiplicada pelo
custo da camiseta no CMV. Para mudar essa lista, crie a variável
`NUVEMSHOP_IGNORAR_PRODUTOS` na Vercel com os termos separados por vírgula.

**Custos.** Nenhum valor de custo vem da loja. Preço de camiseta, embalagem, frete e taxas
saem exclusivamente de Configurações → Custos e taxas, dentro do painel.

## Lançamentos manuais

Continuam disponíveis e sempre estarão: o botão **Novo lançamento** aceita qualquer receita ou
despesa. A automação cobre as entradas e o tráfego; as saídas do dia a dia você lança, e as
fixas ficam cadastradas na Agenda de pagamentos, aparecendo sozinhas todo mês.

---

## Logística

Fica no menu, em **Operação → Logística**. É para quando a Arcanju já tiver estoque.

| Aba | O que faz |
|---|---|
| Expedição | Pedidos da Nuvemshop (pelo conector ou pelo CSV de Vendas), com prazo de envio. Separar dá baixa em camiseta lisa, DTF e brindes. |
| Estoque | Camisetas lisas nas 16 variações, DTF guardado, insumos e malha, com quantos dias cada um dura. |
| Reposição | O que cortar, costurar e comprar para manter o estoque no alvo, respeitando a capacidade da oficina. "Criar as compras" gera tudo com datas. |
| Agenda | Quando cada item acaba, até quando pedir e todos os pagamentos: compras feitas (valor exato), reposições previstas (valor estimado) e, se quiser, as contas do Financeiro. |
| Compras | Pagar e receber. Receber soma ao estoque; o corte recebido tira a malha usada. |
| Meta | Se a operação aguenta a meta de pedidos do Planejamento (ou uma meta simulada): oficina, cortador, malha, DTF, brindes, expedição e estoque alvo, com os ajustes necessários. |
| Indicadores | Envio no prazo, tempo até o envio, falta de estoque, dinheiro parado e custo real contra o custo do Financeiro. |
| Ajustes | Prazos, preços, capacidade, grade e feriados. |

**Como conversa com o Financeiro**

- Lê as vendas dos últimos 30 dias e a meta de pedidos de cada mês (Planejamento) para prever o consumo.
- Na aba Meta, dá para levar uma meta simulada para o Planejamento.
- Os pagamentos das compras aparecem na **Agenda**. Pagar lá ou na Logística dá no mesmo.
- Com custo das camisetas e dos brindes em modo automático, a compra paga **não** vira lançamento, porque o Financeiro já conta esse custo a cada venda. Em modo manual, ela vira lançamento.
- Em Indicadores, o botão de custo cria uma vigência nova em Custos, valendo do mês atual em diante.

Depois de subir esta versão, **Buscar na Nuvemshop** usa a rota nova `api/expedicao.js`. Nada precisa mudar nas variáveis de ambiente.

## Projeto Lazarus

Fica em **Missões → Projeto Lazarus**. Ele roda em um quadro separado (`lazarus.html`) e **não lê nem escreve nada** do Financeiro ou da Logística. Os dados dele ficam no navegador, em uma chave própria.

Para trazer os dados do Lazarus que você já usa no Claude: lá, em **Ajustes → Cópia de segurança → Baixar cópia**. Aqui, no mesmo lugar, **Restaurar de um arquivo**.

## Produção e portal da equipe

**No painel:** Operação → Produção.

| Aba | O que faz |
|---|---|
| Acompanhamento | Sincroniza com o portal: envia os pedidos em aberto da Logística como ordens de serviço e traz o andamento. Pedidos separados, embalados e postados no portal atualizam a Logística e o estoque. |
| Ordens de serviço | Imprime as ordens, 4 por folha A4. |
| Equipe | Pessoas, PIN, dias, horários e pedidos por dia. |
| Guia e rotina | Prensa, horário limite da agência, roteiro do dia, limpeza e passo a passo que a equipe vê. |
| Avisos | Problemas registrados pela equipe. |

**Portal da equipe:** `seu-endereço/producao`. Fica fora da senha do painel (veja `middleware.js`) e tem entrada própria por PIN. A pessoa vê só:

- **Hoje:** pedidos para postar, tempo até a agência, roteiro do dia e limpeza.
- **Pedidos:** ordens na ordem de prioridade, em duas ondas, com um botão para cada etapa (separar, prensar, conferir, embalar, etiqueta, levar à agência).
- **Prensa:** lista de recorte do DTF e prensagem agrupada por estampa.
- **Envio:** embalar, pagar e colar etiquetas em lote, levar à agência.
- **Guia:** padrões de trabalho.
- **Avisar problema:** chega na aba Avisos do painel.

Se houver lotes do Projeto Lazarus, o portal mostra uma segunda linha, "Projeto Lazarus", separada da Use Arcanju.

**Para ligar:**

1. Crie um banco no Upstash (ou use a integração Upstash da Vercel) e coloque `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` nas variáveis de ambiente.
2. Confirme que a `APP_KEY` está preenchida na Vercel e em Integrações do painel. Sem ela, o portal não aceita pedidos do painel.
3. No painel, em Produção → Equipe, cadastre a pessoa com um PIN e toque em **Salvar e enviar ao portal**.
4. Toque em **Sincronizar agora** sempre que trouxer pedidos novos na Logística.

**Projeto Lazarus e o portal:** no Lazarus (aberto pelo painel), em Ajustes, coloque a mesma chave de acesso. Em cada lote, **Enviar à produção** manda os pedidos do lote, e **Atualizar andamento** marca o lote como estampado e postado quando a equipe terminar. O Lazarus continua sem ler nem escrever nada do Financeiro ou da Logística.
