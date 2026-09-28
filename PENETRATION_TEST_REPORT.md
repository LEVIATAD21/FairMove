# FairMove — Penetration Test Report

**Scope:** autonomous red team mission against the local stack (Express 5 +
Drizzle + Postgres 15 + Redis 7 + WS realtime), executed with real attacks
(curl/scripts against a live backend), followed by fixes, re-attacks with
variations, and automated regression tests.

**Date:** 2026-09-27/28 · **Tester:** autonomous agent · **Build:** `main`
(post-hardening + red team fixes).

**Methodology:** Phases A–H (recon → auth/authz → financeiro → injeção →
DoS → lógica de negócio → infra → ataques FairMove específicos). Every
finding was exploited live before the fix (PoC "antes") and re-attacked after
the fix (PoC "depois"), plus at least one variation. Every fix has an
automated test in `tests/security/`.

**Metrics:**

| Métrica | Valor |
|---|---|
| Endpoints mapeados (recon) | ~100 |
| Ataques executados (curl/scripts) | 130+ |
| Vulnerabilidades exploráveis encontradas e corrigidas | 5 |
| Falsos positivos descartados | 3 |
| Testes automatizados de segurança | 42 (7 suítes em `tests/security/`) |
| Suíte completa | verde (ver gates no fim) |
| CVEs `pnpm audit --prod` | 6 → 1 (restante: uuid de toolchain Expo, não explorável) |

---

## Vulnerabilidades encontradas e corrigidas

### [CRITICAL] Race em `POST /rides/:id/complete` → HTTP 500 (settlement TOCTOU)

**Impacto:** dois completions simultâneos derrubavam o perdedor com 500,
expondo erro interno e deixando a API inconsistente para o cliente; o
idempotency key no ledger podia ser re-executado em uma transação já
abortada.

**Causa raiz (três camadas):**
1. Drizzle ≥ 0.45 envolve violações de unique em `DrizzleQueryError` com o
   código real em `error.cause.code` — `isUniqueViolation` olhava só
   `.code` e não reconhecia `23505`.
2. `findByIdempotencyKey` rodava **dentro** da transação já abortada pelo
   primeiro insert → a consulta falhava antes de detectar o replay.
3. A rota `complete` não capturava `DuplicateOperationError` vindo do
   settlement → erro genérico 500.

**PoC (antes):** 4 requests `POST /rides/:id/complete` em paralelo →

```
HTTP/1.1 200 OK
HTTP/1.1 500 {"error":"Internal server error"}   ← perdedor
HTTP/1.1 500 ...
Unhandled error: duplicate key value violates unique constraint ...
```

**Correção:**
- `isUniqueViolation` percorre a cadeia `cause` (profundidade 5) até achar
  `code === "23505"` (`wallet-engine.ts`);
- `insertLedgerTransaction` consulta a chave de idempotência via pool
  (`db`) **fora** da transação abortada;
- `settlement.ts` captura `DuplicateOperationError` e responde
  `alreadySettled` (helper `readSettledResult`);
- rota `complete` captura o erro → `409 Ride already settled`.

**PoC (depois):** 4 completions paralelos →

```
200 / 400 / 409 / 409        → zero 500
saldo passageiro: 43828 → 42602 (exatamente 1 débito)
saldo driver:     11172 → 12398 (exatamente 1 crédito)
ledger: 1 transação ride:<id>:passenger-debit, 1 driver-credit
```

**Variação testada:** replays sequenciais do vencedor → `409` (nunca
re-cobra). **Teste:** `tests/security/race-conditions-and-idor.test.ts`
("completar a mesma corrida em paralelo: settle exatamente 1×, zero 500,
saldos exatos").

---

### [HIGH] Limite `max_uses` das campanhas de cupom nunca era aplicado

**Impacto:** campanha "máximo 1 uso" aceitava uso ilimitado sob concorrência
— prejuízo direto (desconto indevido em N corridas). O `evaluateCoupon` só
checava `coupon.max_uses`, e `campaign.max_uses` era puramente informativo;
não existia claim atômico.

**PoC (antes):** corridas de 2 usuários distintos, `maxUses=1`, apply
simultâneo →

```
POST /api/promotions/apply (user A) → 200 {discountApplied: true}
POST /api/promotions/apply (user B) → 200 {discountApplied: true}
campaign.uses_count = 2             ← limite violado
campaign.uses_count vs max_uses: 2/1, 1 redemption a mais
```

**Correção:**
- **Preflight:** `evaluateCoupon` rejeita quando
  `campaign.uses_count >= campaign.max_uses` ("Campanha esgotada");
- **Claim atômico:** `redeemCoupon` roda em `db.transaction` com UPDATE
  condicional (`uses_count < max_uses`) em campaigns **e** coupons no mesmo
  commit; falha no claim → `CouponExhaustedError` → rollback total;
- resposta `400` com mensagem clara.

**PoC (depois):** mesmo race →

```
user A → 200 {discountApplied: true}
user B → 400 {"error":"Campanha esgotada"}
campaign.uses_count = 1/1
promotion_redemptions: exatamente 1
```

**Variação:** terceiro usuário, sequencial → `400` e nada muda.
**Teste:** `tests/security/coupon-race.test.ts`.

---

### [MEDIUM] Reaplicar cupom devolvia `finalPrice: R$0` (resposta mentirosa)

**Impacto:** app/cliente podia exibir ou cobrar R$0 ao reaplicar um cupom
(o banco estava correto — R$2; só a resposta recalculava o desconto sobre o
preço **já líquido**: `preço - (preço - desconto)` = 0).

**PoC (antes):**

```
POST /api/promotions/apply (1ª vez) → finalPrice 2.00 ✓
POST /api/promotions/apply (2ª vez) → finalPrice 0.00   ← mentira
ride.finalPassengerPrice = 200 centavos (estado real)
```

**Correção:** branch `alreadyApplied` em `applyPromotion` — quando o
desconto já está persistido (`ride.promotionDiscount > 0`), devolve o preço
persistido como fonte da verdade.

**PoC (depois):** segunda apply → `finalPrice 2.00`, `discountApplied true`,
mesmo `redemptionId` (idempotente, 1 redemption). **Teste:**
`tests/security/coupon-race.test.ts` ("resposta honesta").

---

### [MEDIUM] Payload JSON > 10 kb → HTTP 500 (erro de cliente tratado como erro do servidor)

**Impacto:** qualquer cliente malicioso ou bugado provocava `500` +
`Unhandled error: request entity too large` no log; status errado para um
erro do cliente e ruído operacional.

**PoC (antes):**

```
PUT /api/v1/users/profile  (body ~20 kb)
HTTP/1.1 500 {"error":"Internal server error"}
log: Unhandled error: request entity too large
```

**Correção:** error handler central (`backend/src/error-handler.ts`,
exportado para teste): `entity.too.large` → `413`, `entity.parse.failed` /
JSON malformado → `400`, charset/encoding → `415`, resto → `500` genérico
sem stack.

**PoC (depois):**

```
PUT /api/v1/users/profile  (body ~20 kb) → 413 {"error":"Payload too large"}
POST com '{"name":'                        → 400 {"error":"Malformed JSON body"}
GET /api/boom (erro interno)               → 500 {"error":"Internal server error"}
                                             (corpo sem stack/mensagem interna)
```

**Teste:** `tests/security/input-validation.test.ts`.

---

### [HIGH] 6 CVEs em dependências (1 high + 5 moderate) — reduzido para 1

**PoC (antes):**

```
$ pnpm audit --prod
1 high, 5 moderate:
  js-yaml >=3.0.0 <3.15.2        (maxTotalMergeKeys CPU DoS)
  qs >=2.2.5 <6.16.0             (DoS via isBuffer; array-limit bypass)
  morgan <1.12.0                 (log forging por Unicode não escapado)
  decode-uri-component <=0.4.2   (DoS)
  uuid <11.1.1                   (buffer bounds em v3/v5/v6 + buf)
```

**Correção:** overrides em `pnpm-workspace.yaml` (pnpm 11 **ignora**
`package.json#pnpm.overrides` — warning explícito no install):

```yaml
overrides:
  qs: 6.16.0                 # runtime (express/body-parser)
  morgan: 1.12.0             # dependency direta do backend
  js-yaml: 3.15.2            # toolchain (jest/istanbul)
  decode-uri-component: 0.5.0
```

`uuid` do Expo/xcode **não** foi sobrescrito (quebraria o toolchain mobile;
o bug exige `buf` com v3/v5/v6 — o projeto usa só v4 sem buffer).

**PoC (depois):** `pnpm audit --prod` → `1 vulnerabilities found
(1 moderate: uuid, aceito)`. **Nota:** log forging do morgan foi também
atacado ao vivo via User-Agent com `U+2028/U+2029` e **não se reproduziu**
(0 ocorrências no log — o parser HTTP do Node não repassa separators de
linha), mas o upgrade foi aplicado assim mesmo.

---

## Ataques bloqueados (sem vulnerabilidade — evidência de PoC)

### IDOR / acessos cruzados — 15/15 bloqueados

Requisições autenticadas como atacante (`redteam-attacker@evil.dev`)
contra recursos da vítima (`e2e.passenger@fairmove.dev`):

```
GET    /wallets/<victim>            → 403
GET    /wallets/<victim>/history    → 403
GET    /subscriptions/<victim>      → 403
POST   /subscriptions/<victim>/opt-out → 403
GET    /safety/... (victim)         → 403/404
GET    /fraud/... (victim)          → 403
GET    /auth/sessions (victim)      → 403
GET    /rides/<victim-ride>         → 404
POST   /rides/<victim-ride>/cancel  → 403
GET    /matching/drivers/nearby     → 401/403 (admin)
```

Falso positivo descartado: `GET /wallets/me?userId=<victim>` → 200 com a
carteira **do próprio** usuário (o query param é ignorado).

### JWT — 7/7 bloqueados

```
alg: none (assinatura vazia)        → 401
assinar com secret "secret"         → 401
payload adulterado (role→admin)     → 401
payload corrompido (byte alterado)  → 401
token expirado                      → 401
token válido sem linha de sessão    → 401
token de lixo / header ausente      → 401
```

Verificação fixada em `HS256` + sessão no banco (JWT roubado com sessão
revogada não serve). **Teste:** `tests/security/jwt-attacks.test.ts`.

### Privilégio / mass-assignment — 3/3 bloqueados

```
POST /auth/register com role=admin  → 201 com role "passenger" (hardcoded)
POST /users/profile com role/admin  → 400 (Zod strict)
POST /auth/register com __proto__   → Object.prototype intacto
```

**Teste:** `tests/security/input-validation.test.ts`.

### Financeiro — 8/8 bloqueados

```
POST /admin/credit com amount negativo/gigante/abc → 400
POST /admin/credit self como admin (via rota errada) → 403
POST /wallets/deposit → 501 (sem gateway real — correto)
Idempotency replay: 5 envios da mesma key → 1×201 + 4×409, saldo intacto
Race de payout: 6× R$12 em saldo R$60 → 5×201 + 1×409, fechamento exato
```

### Máquina de estados de corrida — 6/6 bloqueados

```
POST /rides/<id>/accept como passageiro        → 403
PATCH status por usuário não-motorista         → 400 (Zod/dono)
Pulo de estado (REQUESTED → IN_PROGRESS)       → 400 "Invalid transition"
PATCH → COMPLETED direto                       → 400
cancel com passageiro a bordo (PASSENGER_ONBOARD) → 400
                                              "Invalid transition ..."
corrida de distância 0 / coords fora do bounds → 400
```

**Teste:** `tests/security/race-conditions-and-idor.test.ts`.

### Injeção — 6/6 bloqueados

```
login email: admin' OR '1'='1 | '; DROP TABLE users;--  → 400 (Zod)
login password: ' OR '1'='1                             → 401 (sem bypass)
GET /rides/1' OR '1'='1 | /..%2F..%2Fetc%2Fpasswd       → 400/404
cupom/history com payloads SQL                          → 400/404
tabela users intacta após todas as tentativas           ✓
```

### Rate limiting / DoS — 5/5 bloqueados

```
6º login em 15min (mesma conta)     → 429 (loginLimiter 5/15min)
21º request de API com XFFs distintos → 429 no 21º (TRUST_PROXY=false:
                                         XFF forjável é ignorado)
121º GET /health em 15min           → 429 (healthLimiter 120/15min)
query string com nesting profundo (qs) → 200 normal, sem CPU spike
JSON >10 kb                         → 413 (antes 500 — ver acima)
```

### Transporte / infra — 5/5 bloqueados

```
CORS: Origin https://evil.com não é refletido (ACAO fixo em localhost:3000)
Helmet: HSTS, X-Frame-Options SAMEORIGIN, nosniff, Referrer-Policy ✓
WS: token na query string → 401; sem subprotocolo → 401; fraude → 401
500 genérico: corpo sem stack/mensagem interna ✓
forgot-password: token nunca aparece no log ("token redacted") ✓
```

---

## Falsos positivos descartados

1. **`/wallets/me?userId=` "IDOR"** — retorna a carteira do próprio usuário.
2. **Log forging via User-Agent com `U+2028`** — não reproduzido (parser
   HTTP do Node rejeita/não repassa separators; 0 ocorrências no log).
3. **Reset token "vazando"** — era a flag legada `EXPOSE_RESET_TOKEN`
   (test-only); produção responde sempre genérico e loga `redacted`.

## Riscos aceitos (documentados)

- **uuid@7** (transitivo do Expo/xcode): exigiria override global que quebra
  o toolchain; o bug só afeta v3/v5/v6 com `buf` — não usado no projeto.
- **GPS spoofing**: servidor não tem como provar a localização real do
  device; mitigável só com signals de fraude (score existe no módulo fraud).
- **Enumeração de contas**: mitigada por resposta uniforme + rate limit,
  não eliminada.
- **Gateway de pagamento mock**: regras de autorização e validação são
  reais, valor financeiro não.
- **`TRUST_PROXY=false`**: atrás de LB/nginx na produção é preciso ligar
  `TRUST_PROXY=true` sob pena de rate limit verer um único IP (documentado
  em `backend/src/index.ts`).
- **Build Docker do backend em Node 20** falha (pendência separada).

## Gates finais (missão red team)

| Gate | Resultado |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm test` (suíte completa) | verde (ver contagens no PR) |
| `tests/security/` (regressão) | 7 suítes / 42 testes verdes |
| `pnpm audit --prod` | 1 (uuid aceito) |

## Recomendações para o próximo ciclo

1. Integrar `pnpm audit --audit-level moderate` no CI (falhar em nova CVE).
2. Cobrir `tests/security/` com job dedicado no CI (paralelo ao resto).
3. Adicionar corpus de fuzzing para os schemas Zod públicos.
4. Avaliar mTLS/introspecção de token quando houver PSP real.
5. Revisar limites de rate limit sob carga real (hoje calibrados para dev).
