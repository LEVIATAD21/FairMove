# FairMove — Threat Model

Visão ameaça→controle do sistema, alinhada com o que existe hoje no código
e com os achados do penetration test
([PENETRATION_TEST_REPORT.md](PENETRATION_TEST_REPORT.md)). Formato STRIDE
por componente.

## 1. Ativos

| Ativo | Sensibilidade |
|---|---|
| Credenciais (hash bcrypt) e sessões | Alta |
| JWT de acesso/refresh (15min / 7d) | Alta |
| Saldos, ledger e transações de carteira | Crítica |
| Preços, descontos, cupons e campanhas | Alta |
| Localização em tempo real do motorista (WS) | Alta |
| Dados de segurança (SOS, incidentes, contatos) | Alta |
| Segredos operacionais (JWT_SECRET, REDIS_URL, DATABASE_URL) | Crítica |

## 2. Superfícies e confiança

- **Público sem token:** `/auth/*` (login/register/reset), `/health`,
  `/ready` — todos rate limited.
- **Autenticado:** demais rotas `/api/v1/*` + WebSocket `/ws`.
- **Admin:** payments, creditos, campanhas, leaderboards, matching,
  reserves admin — sempre `requireRole("admin")`.
- **Confiança externa:** Postgres e Redis somente `127.0.0.1` com senha;
  proxy/trust só via `TRUST_PROXY` explícito.

## 3. Ameaças por componente (STRIDE)

### 3.1 Autenticação (`packages/auth`)

| Ameaça | Exemplos testados | Controle |
|---|---|---|
| Forgeria de token (S) | `alg: none`, secret fraco, payload adulterado | `verify(..., { algorithms: ["HS256"] })` + secret forte obrigatório no boot;7 PoCs → 401 |
| Replay de token (R) | token expirado, sessão revogada | TTL 15min + conferência de linha de sessão por request; rotação com revogação em reuse |
| Enumeração (I) | cadastro/ login por e-mail errado | resposta 409/401 uniforme + rate limits (5/15min por conta) |
| Força bruta (D) | 6º login em 15min → 429 | `loginLimiter` (por e-mail) + `authLimiter` (por IP) |
| Escalada de privilégio (E) | `role=admin` no register/profile | role fixo `passenger` no insert; Zod strict em profile; mass-assignment → 400 |

### 3.2 Autorização (`requireAuth` / `requireRole` / `requireSelfOrRole`)

| Ameaça | Exemplos testados | Controle |
|---|---|---|
| IDOR (E) |15 rotas com ID da vítima | dono/role checado na rota (403/404);15/15 bloqueados |
| Confusão de parâmetro | `?userId=` em `/wallets/me` | identidade vem **sempre** do token, nunca do query |

### 3.3 Carteira e pagamentos (`packages/wallets`, `packages/payments`)

| Ameaça | Exemplos testados | Controle |
|---|---|---|
| Double-spend (E) | 6 payouts paralelos de R$12 em saldo R$60 | transação única + débito condicional;5×201 +1×409, fechamento exato |
| Replay idempotente | 5 créditos com a mesma key | chave única na MESMA transação →1×201 + 4×409 |
| Valores hostis | negativo, gigante, `abc`, `1e999` | Zod →400 |
| Erro interno como fogo (D) | race de settlement →500 | `isUniqueViolation` pela cadeia `cause` + catch `DuplicateOperationError` →409 |
| Crédito indevido (E) | admin creditar a si | regra de role na rota; gateway mock sem valor real |

### 3.4 Corridas (`packages/rides`)

| Ameaça | Exemplos testados | Controle |
|---|---|---|
| Corridas fantasma (D) | passageiro criando2ª corrida |409 com corrida ativa |
| TOCTOU de aceite (E) |2 drivers aceitando a mesma corrida | claim atômico (UPDATE condicional); exatamente1 vence |
| Pulo de estados (E) | REQUESTED → IN_PROGRESS; PATCH → COMPLETED; cancel com passageiro a bordo | máquina de estados (`transitionRide`);6/6 → 400/403 |
| Dados impossíveis (I) | distância0 km, coordenadas fora do mundo | validação Zod + limites geográficos →400 |

### 3.5 Promoções (`packages/promotions`)

| Ameaça | Exemplos testados | Controle |
|---|---|---|
| Estouro de limite (E) |2 usuários em campanha `maxUses=1` | preflight + claim atômico transacional;400 "Campanha esgotada" |
| Resposta mentirosa (I) | reaplicar cupom devolvendo R$0 | estado persistido como fonte da verdade (`alreadyApplied`) |
| Cupom em corrida alheia (E) | atacante aplicando em ride da vítima |403 (dono da corrida) |
| Campanha via API comum | CRUD de campanha sem admin | `requireRole("admin")` →403 |

### 3.6 Entrada de dados e transporte

| Ameaça | Exemplos testados | Controle |
|---|---|---|
| SQLi (I) | login, path de corrida, cupom, history | Drizzle parametrizado + Zod nos paths;6/6 →400/404/401 e tabelas intactas |
| Prototype pollution (E) | `__proto__`/`constructor` no register | `JSON.parse` sem merge + Zod; `Object.prototype` intacto |
| Payload gigante (D) | JSON >10 kb →500 | `express.json({ limit: "10kb" })` + error handler →413 |
| CSRF/XSS (T) | resposta HTML? | API JSON-only, sem refletivo; CORS com origem fixa |
| Interceptação (T) | — | TLS obrigatório em produção (fora do escopo local); HSTS via Helmet |

### 3.7 Realtime (`packages/realtime` — WS)

| Ameaça | Exemplos testados | Controle |
|---|---|---|
| Handshake sem token | token na query string; sem subprotocolo | token só via `Sec-WebSocket-Protocol: fairmove.auth`;15/15 PoCs →401/101 só no legítimo |
| Flood de handshake (D) | — | rate limit15/min/IP |

### 3.8 Infraestrutura (`backend/src`)

| Ameaça | Exemplos testados | Controle |
|---|---|---|
| Forjar IP (D) |21 XFFs distintos | `TRUST_PROXY=false` (XFF ignorado) →429 no21º |
| Forjar log (I) | User-Agent com `U+2028` | não reproduzido + `morgan`1.12.0 (CVE corrigida) |
| Vazar segredos em erro (I) | forçar500 | corpo `{"error":"Internal server error"}` sem stack; `/health`/`/ready` sem `error.message` |
| Vazar token de reset (I) | forgot-password | log `token redacted`; banco guarda só SHA-256; resposta sem token |
| CVEs de dependência (D) | `pnpm audit`6 →1 | overrides em `pnpm-workspace.yaml`; uuid restante aceito (não explorável) |

## 4. Fluxos críticos e invariantes

1. **Settlement de corrida:** exatamente UMA transação de débito (passageiro)
   e UM crédito (driver) por corrida, idempotente sob concorrência.
2. **Saldo:** qualquer mutação inteira numa transação; ledger e saldo
   trocam juntos ou nada.
3. **Cupom:** `campaigns.uses_count` e `coupons.uses_count` nunca ultrapassam
   `max_uses`, mesmo sob race;1 redemption por corrida vencedora.
4. **Identidade:** `req.user.id` vem só do JWT verificado + sessão viva.
5. **Estados de corrida:** toda transição passa pela máquina de estados.

## 5. Fora de escopo / aceitos

- GPS spoofing (sem ground truth server-side) — mitigação via risk score.
- Enumeração de contas — mitigada, não eliminada.
- Gateway de pagamento mock (regras reais, dinheiro fictício).
- Supply chain do Expo (uuid@7 etc.) — documentado.
- DoS distribuído de largura de banda — rate limits são por IP.

## 6. Revisão

- Atualizado a cada missão de red team; próxima revisão: ao adicionar PSP
  real, novo método de auth ou mudar `TRUST_PROXY`/rede de deploy.
