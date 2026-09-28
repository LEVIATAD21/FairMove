# FairMove — Security

Guia operacional de segurança: como o sistema se protege, o que você precisa
configurar em cada ambiente e como reportar vulnerabilidades. Detalhe técnico
dos ataques e correções: [PENETRATION_TEST_REPORT.md](PENETRATION_TEST_REPORT.md);
modelo de ameaças: [THREAT_MODEL.md](THREAT_MODEL.md).

## Reportando uma vulnerabilidade

Abra um issue privado (GitHub Security Advisory) ou contate a equipe
mantenedora. Inclua passos de reprodução; não publique PoC antes da correção.

## Configuração obrigatória

| Variável | Regra (falha no boot se violada) |
|---|---|
| `JWT_SECRET` | ≥ 32 chars (≥ 64 em produção), ≠ `REFRESH_TOKEN_SECRET` |
| `REFRESH_TOKEN_SECRET` | idem |
| `JWT_EXPIRES_IN` | em produção não pode usar dias no access token |
| `DATABASE_URL` | Postgres com senha; bind em `127.0.0.1` em dev |
| `REDIS_URL` | deve incluir `requirepass` |
| `TRUST_PROXY` | `true` **somente** atrás de nginx/LB (senão XFF forja rate limit) |

Gerar segredos: `openssl rand -base64 48`.

## Proteções ativas

### Autenticação e sessões
- Access token JWT (HS256 fixado) de 15 min + refresh de 7 dias com rotação.
- Refresh armazenado como SHA-256; reuse de token rotacionado revoga a
  sessão inteira.
- Sessão conferida no banco a cada request (logout/revogação imediata).
- Reset de senha: token só como hash no banco, nunca em log nem resposta.
- Rate limits: login 5/15min por conta, auth 20/15min por IP,
  API global 100/15min por IP, health 120/15min, WS handshake 15/min/IP.

### Autorização
- Papéis `passenger` / `driver` / `admin`; admin explícito em payments,
  creditos, campanhas, leaderboards, matching e reserves.
- Identidade sempre do token — nunca de query/body (anti-IDOR).
- Registro força `role: "passenger"`; Zod **strict** impede mass-assignment.

### Dinheiro
- Toda mutação de saldo em **uma** transação com ledger na mesma sessão.
- Idempotency key única (violação `23505` ⇒ replay, não erro).
- Settlement de corrida idempotente sob concorrência (winner único,
  perdedores `409`).
- Payout com débito condicional — nunca fica negativo sob race.

### Corridas
- Uma corrida ativa por passageiro (409).
- Aceite com claim atômico — dois drivers nunca dividem a mesma corrida.
- Máquina de estados valida cada transição (pulo de estado → 400).

### Promoções
- Limite de `max_uses` de campanha **e** cupom com claim atômico
  transacional (race → 400, nunca estouro).
- Respostas refletem o estado persistido (idempotente e honestas).

### Transporte e entrada
- Helmet (HSTS, X-Frame, nosniff, Referrer-Policy), CORS com origem fixa.
- `express.json`/`urlencoded` limitados a 10 kb; excedente → 413;
  JSON malformado → 400 (nunca 500).
- WebSocket: token apenas no header `Sec-WebSocket-Protocol`
  (`fairmove.auth`) — nunca na query string.
- Drizzle parametrizado em todas as queries (sem SQL string concat).

### Logs e erros
- Tokens/segredos redigidos (`token redacted`).
- Erros500 respondem corpo genérico sem stack; `/health` e `/ready`
  não expõem mensagens internas.

## Testes de segurança automatizados

Diretório `tests/security/` (roda no `pnpm test`):

| Suíte | Cobre |
|---|---|
| `double-spend.test.ts` | transações atômicas, idempotência, replay |
| `race-conditions-and-idor.test.ts` | accept TOCTOU, settlement concorrente, IDOR de rotas, refresh/reuse, redação de token |
| `jwt-attacks.test.ts` | `alg: none`, secret fraco, payload adulterado, expirado, sessão revogada |
| `input-validation.test.ts` | 413/400/415 do error handler, SQLi, escalada de papel, prototype pollution |
| `coupon-race.test.ts` | limite de campanha sob race, resposta honesta ao reaplicar |
| `ws-handshake.test.ts` | handshake WS com/sem token, subprotocolo, rate limit |
| `subscription-trial.test.ts` | anti-loop de trial e guarda de billing |

Requer `DATABASE_URL` (senão as suítes de DB são puladas).

## Dependências

- `pnpm audit --prod` deve ficar em 0-1 (uuid de toolchain Expo é aceito e
  documentado — não explorável).
- Overrides de segurança ficam em `pnpm-workspace.yaml` → `overrides`
  (pnpm 11 **não** lê mais `package.json#pnpm.overrides`).
- Ao adicionar dependência: conferir `pnpm audit` antes do merge.

## Checklist de release

1. `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
2. `pnpm audit --prod`
3. Segredos de produção fora do repositório (`.env*` gitignored)
4. `TRUST_PROXY=true` apenas atrás de proxy confiável
5. Postgres/Redis não expostos fora da rede interna
