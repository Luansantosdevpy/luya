# Luya · Calculadora de preço de venda

Calculadora para precificar peças de roupa, com as peças e configurações salvas no MongoDB.

## Arquitetura

```
src/      → site (React + Vite), roda no navegador
api/      → funções serverless da Vercel (Node), as únicas que acessam o MongoDB
shared/   → tipos e validação usados pelos dois lados
```

| Rota | Método | O que faz |
|---|---|---|
| `/api/session` | GET | informa se há sessão válida |
| `/api/login` | POST | `{ password }` → cria cookie de sessão (máx. 10 tentativas erradas / 15 min por IP) |
| `/api/logout` | POST | encerra a sessão |
| `/api/data` | GET | configurações + peças |
| `/api/settings` | PUT | salva as configurações |
| `/api/products` | PUT / DELETE `?id=` | cria/atualiza ou exclui uma peça |
| `/api/import` | POST | substitui tudo por um backup |

Todas as rotas de dados exigem login. O acesso usa uma senha única (`APP_PASSWORD`) e um
cookie `HttpOnly` assinado com HMAC, válido por 30 dias. Trocar a senha encerra todas as sessões.

### Coleções no MongoDB (banco `luya`)
- `products`: uma peça por documento (`_id` = id da peça)
- `settings`: documento único `_id: "default"`
- `login_attempts`: controle de tentativas de login (apagado sozinho por índice TTL)

Os índices são criados automaticamente pela API.

## Variáveis de ambiente

Veja `.env.example`. São necessárias **no `.env` local** e **na Vercel** (Project → Settings → Environment Variables):

| Variável | Descrição |
|---|---|
| `MONGODB_URI` | string de conexão do seu MongoDB |
| `MONGODB_DB` | nome do banco (padrão `luya`) |
| `APP_PASSWORD` | senha para entrar na calculadora |
| `SESSION_SECRET` | 32+ caracteres aleatórios: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

### Preparando o MongoDB do seu servidor
- **Rede:** as funções da Vercel não têm IP fixo, então o Mongo precisa aceitar conexões externas.
  Compense com **TLS ativado** e **autenticação obrigatória**.
- **Usuário dedicado** com o mínimo de permissão:
  ```js
  use luya
  db.createUser({ user: "luya_app", pwd: "<senha-forte>", roles: [{ role: "readWrite", db: "luya" }] })
  ```
- Prefira configurar a região das funções na Vercel perto do servidor do banco (Project → Settings → Functions).

## Rodar localmente

```bash
npm install
cp .env.example .env   # e preencha
npm run dev            # site + /api em http://localhost:5173
```

O `npm run dev` já serve as funções de `/api` (plugin em `vite.config.ts`), sem precisar do `vercel dev`.

## Deploy na Vercel

1. Suba o projeto para um repositório no GitHub.
2. Na Vercel: **Add New → Project** e importe o repositório (o Vite é detectado sozinho).
3. Cadastre as 4 variáveis de ambiente antes do primeiro deploy.
4. Deploy.

## Como o preço é calculado

```
custo total = custo da peça + frete da compra (por peça) + embalagem/extras + custos fixos rateados
preço       = custo total ÷ (1 − (taxas% + impostos% + margem%) ÷ 100)
```

- **Custos fixos rateados**: soma dos custos fixos mensais ÷ peças vendidas por mês.
- **Taxas e impostos** são calculados sobre o preço final (maquininha, plataforma, imposto).
- **Margem** é o lucro líquido em % do preço de venda (30% = R$ 30 de lucro a cada R$ 100).
- O preço é arredondado **para cima** (padrão: terminar em ,90).

A lista de peças recalcula tudo com as configurações atuais e avisa quando uma peça
ficou abaixo da margem desejada (ex.: depois de um aumento de taxa).

### Quando tiver CNPJ
- **MEI**: o DAS é fixo por mês, então lance-o em *Custos fixos mensais* e deixe o imposto em 0%.
- **Simples Nacional**: informe a alíquota em *Imposto sobre a venda*.
