# FairMove — Relatório de Bugs (Auditoria Autônoma de Qualidade)

**Escopo:** missão QA autônoma em 7 áreas — assinaturas/trial, máquina de estados de
corrida, cálculos financeiros, matching/geolocalização, performance/paginação/ledger,
edge cases de validação e código morto/higiene.

**Metodologia:** cada bug foi encontrado e comprovado por **execução real** (nunca
análise estática): teste RED documentando o comportamento errado → fix → teste GREEN →
re-ataque → gates (`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`) → **commit
por bug**. O gateway/PSP permaneceu **intocado** (congelado pelo fundador).

**Resultado final: 17 achados — 16 corrigidos, 1 documentado (BUG-C).
Suíte completa: 199/199 testes em 26 suítes (31 cenários novos de auditoria).**

| Área | Bugs | Estado |
|---|---|---|
| 1. Assinaturas/trial | D, A, B, C | 3 corrigidos, 1 documentado |
| 2. Máquina de estados | E2, E3, E4 | 3 corrigidos |
| 3. Cálculos financeiros | F1, F2 | 2 corrigidos |
| 4. Matching/geolocalização | G1 | corrigido |
| 5. Performance/paginação/ledger | H1, H2, H3 | 3 corrigidos |
| 6. Edge cases de validação | I1, I2 | 2 corrigidos |
| 7. Código morto/higiene | J1, J2 | 2 corrigidos |

---

## Área 1 — Assinaturas e Trial

### BUG-D — CRITICAL — `reserve_transactions` definida duas vezes (modelo divergente)

1. **Descrição:** o schema definia a tabela `reserve_transactions` duas vezes — em
   `schema-reserves.ts` (correto, com `reserve_id`) e em `schema-wallets.ts` (órfã,
   com `wallet_id`). O snapshot/migração vigente era a forma `wallet_id`; o runtime
   Drizzle apontava para a forma `reserve_id`.
2. **Cenário:** qualquer `chargeMonthlyFee` que lançasse parcela de reserva
   (`reserveShare > 0`) executava `INSERT ... (reserve_id, ...)` na tabela real.
3. **Output real:** `column "reserve_id" of relation "reserve_transactions" does not
   exist` → crash 500 na cobrança da mensalidade (todo mês 2+ com reserva ativa).
   Verificado no banco: tabela no formato errado com **0 linhas** (nenhum backfill).
4. **Causa raiz:** colisão de definições — `drizzle-kit` criou a tabela pela definição
   órfã; a outra definição continuou no bundle sem alerta (sem índice/unique que
   divergisse).
5. **Diff:** removida a `pgTable` órfã de `schema-wallets.ts` (+ exports
   `wallet_reserve_transactions` de `index.ts`); snapshot `0004` editado removendo a
   key `public.reserve_transactions` (indent 2-space, sem trailing newline);
   `drizzle-kit generate` → `drizzle/0005_aromatic_juggernaut.sql` com
   `DROP TABLE IF EXISTS` prependido; `pnpm db:migrate` aplicado.
6. **Teste:** `tests/subscription-qa-audit.test.ts` — cenário "histórico de reserva".
   RED documentado: crash no INSERT. GREEN: `[BUG-D] histórico de reserva: 1 linha
   [{"amount":4900,...}]`.
7. **Commit:** `13c2a8b`. Dados: tabela com 0 linhas → sem backfill; produção deve
   conferir `drizzle.__drizzle_migrations` antes do deploy.

### BUG-A — CRITICAL — Tier da mensalidade por contador de ciclo (não por meses reais)

1. **Descrição:** o tier (R$0 / R$100 / R$200) era resolvido por
   `currentBillingCycle`, mas a coluna nunca era incrementada — todo mês cobrava
   como "mês 1" (ou o valor errado, conforme a origem do contador).
2. **Cenário:** ativação no dia X; simulação de disparos nos meses 1/2/3.
3. **Output real (RED):** `on-time=R$100 vs disparo=R$200` divergiam; sequência de
   ciclos `0→10000→20000` não avançava.
4. **Causa raiz:** `chargeMonthlyFee` lia `monthsActive = currentBillingCycle || 1`
   mas nunca escrevia `currentBillingCycle + 1`; `activateSubscription` reativava
   sem rebase do contador.
5. **Diff:** em `subscription-engine.ts`: após cobrança (ramo de taxa 0 e ramo pago)
   `currentBillingCycle: monthsActive + 1`; na reativação
   `rebaseCycle = Math.max(resolveMonthsActive(...), currentBillingCycle || 0) || 1`
   aplicado somente quando `trialUsed`. Removido `const now` morto.
6. **Teste:** `tests/subscription-qa-audit.test.ts` (3 cenários RED → GREEN).
   GREEN: fuso `UTC=2 SP=1 Tokyo=2` → tier `2/2/2`; `on-time` e `disparo` ambos
   `R$100`; sequência `0→10000→20000`.
7. **Commits:** `461c548` (fix), `51450d9` (teste).

### BUG-B — HIGH — Cálculo de meses (`resolveMonthsActive`) dependia do fuso local

1. **Descrição:** a contagem de meses usava getters locais (`getMonth()/getDate()`),
   produzindo tiers diferentes no mesmo instante conforme o fuso do processo.
2. **Cenário:** mesmo `startDate`/`now` executados com `TZ=UTC`, `America/Sao_Paulo`
   e `Asia/Tokyo` (probe em processo filho Node — jest congela `process.env.TZ`).
3. **Output real (RED):** contagens divergentes por fuso (ex.: `1/1/2` no mesmo
   instante).
4. **Causa raiz:** `Date#getMonth` local vs `Date` absoluto.
5. **Diff:** `billing-calculator.ts` — `getUTCFullYear/getUTCMonth/getUTCDate`.
6. **Teste:** mesmo arquivo, cenário de fuso compilado com `tsc` e rodado em filhos
   `node` com env TZ. GREEN: `UTC=2 SP=1 Tokyo=2` → `2/2/2`.
7. **Commit:** `4ef447f`.

### BUG-C — HIGH (produto) — Nenhum job automático de billing — DOCUMENTADO, NÃO IMPLEMENTADO

1. **Descrição:** a cobrança da mensalidade só existe via rota admin
   (`POST /subscriptions/:userId/charge`). Sem cron/scheduler, mensalidades nunca
   disparam sozinhas.
2. **Cenário:** esperar a virada do ciclo sem intervenção manual → nada cobra.
3. **Output:** rota funciona (cobrança idempotente por ciclo), mas não há gatilho
   automático — `backend/src/index.ts` só agenda RideExpiry e EventScheduler.
4. **Causa raiz:** feature de billing entregue sem o job de agendamento.
5. **Decisão:** **não implementado nesta missão** — exige decisão de produto
   (janela de disparo, retry/dunning, timezone de cobrança, alertas). Proposta:
   cron diário opt-in (`BILLING_ENABLED=false` por padrão) reutilizando
   `chargeMonthlyFee` (já idempotente).
6. **Teste:** não aplicável (comportamento ausente por design pendente).
7. **Commit:** nenhum — este relatório é o registro.

---

## Área 2 — Máquina de Estados de Corrida

### BUG-E2 — HIGH — Deadlocks de cancelamento (passageiro/motorista presos)

1. **Descrição:** o passageiro não podia cancelar em `DRIVER_ARRIVING`/
   `DRIVER_AT_PICKUP`; o motorista não podia em `DRIVER_ASSIGNED` — sem taxa e sem
   timeout, o estado ficava para sempre (409).
2. **Cenário:** corrida avança até `DRIVER_ARRIVING`; passageiro chama
   `POST /rides/:id/cancel`.
3. **Output real (RED):** `=400/409` ×3 cenários (passageiro em ARRIVING/AT_PICKUP,
   motorista em ASSIGNED).
4. **Causa raiz:** transições ausentes em `state/machine.ts`.
5. **Diff:** `CANCELLED_BY_DRIVER` adicionado em `DRIVER_ASSIGNED`;
   `CANCELLED_BY_PASSENGER` adicionado em `DRIVER_ARRIVING` e `DRIVER_AT_PICKUP`.
6. **Teste:** `tests/qa-ride-state.test.ts` cenário E-1: RED `=400` ×3 → GREEN `=200` ×3.
7. **Commits:** `c10de09` (fix), `2881a9d` (teste).

### BUG-E3 — CRITICAL — Liquidação (dinheiro) ANTES do claim de status no `complete`

1. **Descrição:** `POST /rides/:id/complete` movia o dinheiro (settlement) e só
   depois fazia o CAS `IN_PROGRESS→COMPLETED`. Um `cancel` concorrente vencia o CAS
   e deixava a corrida `CANCELLED` **com o dinheiro já movido**.
2. **Cenário:** 15 execuções de corrida real: `Promise.all([complete, cancel])` com
   driver/passenger/wallets de verdade.
3. **Output real (RED):** **15/15** iterações
   `CANCELLED+DINHEIRO` (`complete=409 cancel=200`, débito≈crédito 1462-1463) —
   passageiro debitado e motorista creditado numa corrida cancelada.
4. **Causa raiz:** ordem das operações — settle precedia o CAS de status.
5. **Diff:** em `rides/routes.ts`: claim CAS `IN_PROGRESS→COMPLETED` **primeiro**;
   settle depois; falha de settle → revert (`status=IN_PROGRESS, completedAt=null`);
   `DuplicateOperationError` → reexecuta settle sem revert (idempotência preservada).
6. **Teste:** cenário E-3 do `qa-ride-state.test.ts`. GREEN: `completed+settled=2
   cancelled+limpo=13 CANCELLED+DINHEIRO=0`.
7. **Commit:** `104e5db`.

### BUG-E4 — HIGH — `EXPIRED` inalcançável + sem timeout → corridas presas para sempre

1. **Descrição:** a máquina previa `REQUESTED/SEARCHING → EXPIRED`, mas nada no
   código setava `EXPIRED` e não havia timeout: corrida abandonada ficava ativa e o
   guard de "corrida ativa única" (409) bloqueava a conta do passageiro para sempre.
2. **Cenário:** criar corrida, nunca buscar motorista, avançar o relógio além do TTL
   (15 min), chamar o sweep.
3. **Output real (RED):** módulo `expiry.ts` inexistente (`Cannot find module`) —
   nenhuma rota/job produzia `EXPIRED`.
4. **Causa raiz:** feature de expiração nunca implementada (faltava job + CAS).
5. **Diff:** novo `packages/rides/src/expiry.ts` (`expireStaleRides`, TTL
   `RIDE_EXPIRY_TTL_MINUTES` padrão 15, CAS por corrida, `releaseRedemptions`,
   `recordRideEvent` exportado, evento Redis); cron `*/1 * * * *` em
   `backend/src/index.ts` (gate `RIDE_EXPIRY_ENABLED=false`, stop no shutdown).
6. **Teste:** cenário E-4. GREEN: `sweep expirou=2 | nova corrida=201`.
7. **Commit:** `1302662`.

---

## Área 3 — Cálculos Financeiros (sem tocar PSP)

### BUG-F1 — HIGH — Cupom resgatado FORA da janela aplicável + resposta mentirosa

1. **Descrição:** `POST /promotions/apply` queimava o cupom (`uses_count++` na
   campanha e no cupom + linha de `promotion_redemptions`) **antes** de checar
   `APPLICABLE_STATUSES`. Em corrida `DRIVER_ARRIVING/IN_PROGRESS/...` o preço **não**
   era atualizado, mas a resposta devolvia `finalPrice` descontado — o passageiro
   pagava cheio e o cupom sumia.
2. **Cenário:** corrida aceita, motorista `DRIVER_ARRIVING`, passageiro aplica cupom
   válido de 10%.
3. **Output real (RED):**
   `[F-1] apply@DRIVER_ARRIVING → status=200 discountApplied=true finalPrice=13.16 | cupom uses 0→1 | preço 1462→1462`
   — resposta afirma R$13,16, corrida segue R$14,62, cupom consumido.
4. **Causa raiz:** ordem errada (redeem → depois o `if (APPLICABLE_STATUSES)`) e
   update de preço em transação separada do resgate (janela de crash = cupom queimado
   sem desconto, sem chance de retry curar).
5. **Diff:** `promotion-engine.ts` — gate `409` **antes** de evaluate/redeem;
   `redeemCoupon` agora recebe `Executor` e roda **na mesma transação** do update de
   preço; update condicional `WHERE status IN (aplicáveis)` — 0 linhas ⇒ rollback
   total do resgate.
6. **Teste:** `tests/qa-finance.test.ts` F-1. RED: `200`, `uses 0→1`, preço intacto.
   GREEN: `409`, `cupom uses 0→0`, `preço 1463→1463`.
7. **Commits:** `ef42dda` (fix), `b4f3bc6` (teste).

### BUG-F2 — HIGH — Cancelamento não devolvia o slot da CAMPANHA (esgotamento fantasma)

1. **Descrição:** `releaseRedemptions` decrementava só `coupons.uses_count`;
   `campaigns.uses_count` nunca era restaurado — cada corrida cancelada consumia 1
   vaga da campanha **para sempre**.
2. **Cenário:** campanha `maxUses=2`; 3 ciclos de criar corrida → aplicar → cancelar.
3. **Output real (RED):** `[F-2] ciclo 1: ... campanha.uses=1/2` (deveria voltar a 0);
   ciclo 3 → `400 "Campanha esgotada"` com o cupom vazio. Dado real corrompido no
   banco: campanha `RT-RACE` com `uses_count=2 > max_uses=1` (corrigido para 1 na
   migração manual de dados).
4. **Causa raiz:** decremento incompleto (redemption não guarda `campaignId`; era
   preciso ir via `coupons.campaign_id`).
5. **Diff:** `releaseRedemptions` — transação única: delete do resgate + decremento
   do cupom + decremento da campanha (via `campaignId`), idempotente.
6. **Teste:** F-2 e F-3 do `qa-finance.test.ts`. GREEN: 3 ciclos todos aplicam,
   `campanha 1→0` no cancel.
7. **Commit:** `0424ce9`.

---

## Área 4 — Matching e Geolocalização

### BUG-G1 — HIGH — Double-booking: motorista com corrida ativa se marcava disponível

1. **Descrição:** `POST /api/matching/driver/status` aceitava `{available: true}` de
   motorista em `DRIVER_ASSIGNED+`. O guard de `accept` checa **apenas**
   `driver.available` — o motorista se liberava e aceitava uma segunda corrida.
2. **Cenário:** motorista aceita corrida 1; envia `{status:"online", available:true}`;
   passageiro 2 cria corrida; mesmo motorista aceita a corrida 2.
3. **Output real (RED):**
   `[G-1] status→200 | accept2→200 | corridas ativas do motorista=2 ["…:DRIVER_ASSIGNED","…:DRIVER_ASSIGNED"]`
4. **Causa raiz:** o endpoint de status tratava `available` como flag livre do
   cliente, sem invariant "motorista com corrida na mão não fica disponível".
5. **Diff:** `matching/routes.ts` — quando `available === true`, consulta corridas do
   motorista em `DRIVER_ASSIGNED..IN_PROGRESS`; se houver → `409 "Driver has an
   active ride"`. (Status sem a flag continua livre — `available` não é tocado.)
6. **Teste:** `tests/qa-matching.test.ts` G-1. GREEN: `status→409 | accept2→409 |
   corridas ativas=1`.
7. **Commits:** `478795e` (fix), `ae9a8b9` (teste).

Sanidade verificada (sem bug): nearby exclui ocupado/offline; coordenada inválida →
400/`[]`; accept concorrente de 2 motoristas → exatamente 1 vence e o perdedor volta
a `available=true` (rollback).

---

## Área 5 — Performance, Paginação e Ledger

### BUG-H1 — HIGH — Extrato financeiro sem `ORDER BY` (LIMIT cortava janela arbitrária)

1. **Descrição:** `GET /api/wallets/:userId/transactions` (limit 200) e
   `/entries` (limit 500) não tinham ordenação — o banco retornava ordem física e o
   `LIMIT` mantinha as linhas **mais antigas**, escondendo as novas em silêncio.
2. **Cenário:** semear 205 transações e 505 entradas com `created_at` crescente e
   pedir o extrato.
3. **Output real (RED):**
   `[H-1] transactions: 200 linhas | ordenadoDesc=false | primeiro=16a46816 (esperado 1e81b49a)`.
4. **Causa raiz:** `SELECT ... WHERE wallet_id=... LIMIT n` sem `ORDER BY`.
5. **Diff:** `wallets/routes.ts` — `orderBy(desc(created_at), desc(id))` nas duas
   listagens.
6. **Teste:** `tests/qa-performance.test.ts` H-1 (transactions E entries).
7. **Commit:** `e7621a1`.

### BUG-H2 — HIGH — Zero índices secundários no banco inteiro (Seq Scan sempre)

1. **Descrição:** só existiam PKs/uniques. Histórico de corridas, sweep de
   expiração (cron **a cada minuto**), filtro de matching, extrato, scoring de fraude
   e release de cupons rodavam Seq Scan em qualquer volume.
2. **Cenário:** `EXPLAIN ANALYZE` das 6 queries quentes antes da migração.
3. **Output real (RED):** `idx ausentes: [9 índices]` (teste H-2) e baseline:
   `history: Seq Scan`, `expiry-sweep: Seq Scan`, `ledger-tx: Seq Scan`,
   `matching: Seq Scan`, `fraud: Seq Scan`, `redemptions: Seq Scan`
   (`/tmp/opencode/qa5_explain_before.log`).
4. **Causa raiz:** schema nunca definiu índices; FKs no Postgres não criam índice.
5. **Diff:** `drizzle/0006_qa_secondary_indexes.sql` (aplicado):
   `rides(passenger_id|driver_id|status × created_at)`,
   `drivers(status, available)`, `ledger_transactions/entries(wallet_id, created_at)`,
   `promotion_redemptions(ride_id)`, `fraud_events(user_id, event_type)`,
   `ride_location_events(ride_id)`.
6. **Teste:** H-2 (guard: todos os 9 criados) + prova de caminho:
   com `enable_seqscan=off`, o planner escolhe exatamente os índices
   (`Index Scan Backward using idx_rides_passenger_created`, `Bitmap Index Scan on
   idx_rides_status_created`, `idx_ledger_tx_wallet_created`,
   `idx_drivers_status_available`, `idx_promotion_redemptions_ride`,
   `idx_ride_location_events_ride` — `qa5_explain_index_proof.log`). Com as tabelas
   micro atuais o planner ainda prefere Seq Scan (**correto**: custo-benefício); o
   ganho aparece com volume.
7. **Commit:** `df5992d`.

### BUG-H3 — MEDIUM — `GET /admin/events` sem LIMIT (resposta não-bounded)

1. **Descrição:** listagem admin sem teto — cresce sem limite com os eventos.
2. **Cenário:** inserir 201 eventos e chamar a rota.
3. **Output real (RED):** `[H-3] admin/events → 201 linhas`.
4. **Causa raiz:** `select().from(events).orderBy(desc)` sem `.limit()`.
5. **Diff:** `.limit(200)` (mesmo teto das demais listagens admin).
6. **Teste:** H-3 do `qa-performance.test.ts`. GREEN: `200 linhas`.
7. **Commit:** `582d1c8`.

---

## Área 6 — Edge Cases de Validação

### BUG-I1 — MEDIUM — Coordenadas `null`/`""`/`true` viravam 0/1 (Ilha Nula)

1. **Descrição:** `LatSchema/LngSchema` eram `z.coerce.number()` puro:
   `Number(null)=0`, `Number("")=0`, `Number(true)=1` passavam na validação de faixa.
2. **Cenário:** (a) `POST /rides` com `pickupLocationLat: null, pickupLocationLng: ""`;
   (b) motorista envia `{lat: true, lng: true}`; (c) `GET nearby?lat=&lng=...`.
3. **Output real (RED):**
   `[I-1] rides lat=null/lng="" → 201 pickup=(0, 0)` — corrida criada na Ilha Nula;
   motorista teleportado para (1,1) com `200`; nearby `200`.
4. **Causa raiz:** coerção do zod sem predicado de tipo (aceita qualquerthing com
   `Number()` definido).
5. **Diff:** `validation/src/index.ts` — `coordinateSchema()`: só `number` finito ou
   `string` numérica não-vazia; depois `transform` + faixa ±90/±180.
6. **Teste:** `tests/qa-validation.test.ts` I-1 (3 sub-asserts). GREEN: `400/400/400`.
7. **Commit:** `847bc22`.

### BUG-I2 — MEDIUM — `endDate: null` criava campanha já expirada (1970)

1. **Descrição:** `CampaignSchema` usava `z.coerce.date().optional()` — `optional`
   não ignora `null`; `new Date(null)` = `1970-01-01` era persistido como fim da
   janela → campanha nascia morta (padrão típico de front que manda `null` em data
   vazia).
2. **Cenário:** `POST /promotions/campaign` com `startDate: null, endDate: null` +
   cupom + `apply` numa corrida.
3. **Output real (RED):** `[I-2] endDate persistido=1970-01-01T00:00:00.000Z` e
   `apply → 400` (janela encerrada).
4. **Causa raiz:** coerção de data sem pre-processamento de `null`.
5. **Diff:** `OptionalDate = z.preprocess(v => v === null ? undefined : v,
   z.coerce.date().optional())` em `startDate/endDate`.
6. **Teste:** I-2 do `qa-validation.test.ts`. GREEN: `endDate=null`, `apply → 200`.
7. **Commit:** `0851e13`.

Guardas executadas (já corretas): `amount: null/"abc"` → 400; senha sem número →
400; chave desconhecida em profile (`.strict()`) → 400; janela de campanha invertida
→ 400.

---

## Área 7 — Código Morto, console.log e TODOs

### BUG-J1 — LOW — `DISPUTED`: estado morto da máquina de estados

1. **Descrição:** `DISPUTED` existia em `machine.ts` (`transições: []`), no
   `RideStatusSchema` e no union `shared-types`, mas **nenhum estado apontava para
   ele** e nenhum código jamais setava o status (o PATCH rejeitava fora de
   `DRIVER_ADVANCE_STATUSES`) — inalcançável por construção.
2. **Cenário:** execução iterando todas as transições `→ DISPUTED` + varredura de
   fonte por escritas do status.
3. **Output real (RED/scan):** definições mortas listadas pelo teste J-2 incluem
   `\bDISPUTED\b` em `machine.ts`, `shared-types` e `validation` (3 arquivos), com
   **zero** setters.
4. **Causa raiz:** estado planejado (disputa de corrida) nunca implementado.
5. **Diff:** removido o estado da máquina, do enum de validação e do union de tipos;
   teste `state-machine.test.ts` ajustado (13 → 12 status).
6. **Teste:** `tests/qa-dead-code.test.ts` J-1 (guard: nenhuma transição chega/sai
   de `DISPUTED`) + J-2 (scan).
7. **Commit:** `669303e`.

### BUG-J2 — LOW — 8 exports de runtime sem uso em lugar nenhum

1. **Descrição:** código morto com custo de manutenção: `canAccessRide`
   (wrapper morto de `loadRideForUser`), `getActiveDriverDiscountPercent`
   (duplicata morta — o `subscription-engine` tem a própria resolução de desconto
   **ativa**), `refreshTokenFingerprint` + helper `sha256` (logging nunca ligado),
   `PLATFORM_REVENUE_ACCOUNT`/`DISCIPLINE_RESERVE_ACCOUNT` (design antigo — o ledger
   credita a wallet do usuário platform), `RideStatusUpdateSchema`/`CouponSchema`
   (rotas usam schemas inline) e `SPLASH_SEQUENCE`/`RIDE_STATES`/`FAIR_PROMO_EXAMPLE`
   (zero imports em packages/apps/tests).
2. **Cenário:** scan executável de todos os `export` runtime de `packages/*/src` e
   `backend/src` contra todos os `.ts/.tsx` do repositório (definição + usos).
3. **Output real (RED):** `[J-2] definições mortas encontradas: [13 ocorrências]`.
4. **Causa raiz:** refactors deixaram twins órfãos; constants de design nunca ligadas.
5. **Diff:** remoções pontuais em 6 arquivos (83 linhas). `MONOGRAM`/`BRAND`/
   `SLOGAN` **mantidos** (usados em `apps/*` e componentes `.tsx`).
6. **Teste:** J-2 do `qa-dead-code.test.ts`. GREEN: `definições mortas: []`.
7. **Commit:** `d5063b6`.

### Higiene verificada por execução (sem violações)

- **console.log:** apenas no allowlist operacional (`events/scheduler.ts`,
  `backend/src/index.ts` boot/cron/shutdown) — sem log de token/senha/dado
  sensível (J-3).
- **TODO/FIXME:** apenas 1, allowlistado e documentado —
  `auth/routes.ts:344` integração de provedor de e-mail (pendência real de
  feature) (J-4).
- **`on_trip`:** valor de enum referenciado pelo app do motorista
  (`apps/driver/src/services/api.ts`) — **mantido**; hoje equivale a `offline` no
  matching (nenhum código seta `on_trip` automaticamente). Documentado como
  consumidor pendente, não removido para não quebrar o client.

---

## Resumo Final

| Métrica | Valor |
|---|---|
| Achados | 17 (16 corrigidos, 1 documentado) |
| CRITICAL | 3 (D, A, E3) — todos corrigidos |
| HIGH | 8 corrigidos (B, E2, E4, F1, F2, G1, H1, H2) + 1 documentado (C) |
| MEDIUM | 3 (H3, I1, I2) |
| LOW | 2 (J1, J2) + documentado C |
| Suíte completa | **199/199 — 26 suítes** |
| Gates | typecheck ✅ lint ✅ build ✅ test ✅ |
| Commits da missão | 23 (`13c2a8b..dd5a165`), commit por bug |
| Restrição PSP | gateway/settlement **intocado** |

Evidências brutas: `/tmp/opencode/qa{4,5,6,7}_{red,green}.log`,
`qa5_explain_{before,after,index_proof}.log` e logs citados por bug.
Relatório de desempenho: `PERFORMANCE_REPORT.md`.
