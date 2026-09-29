# FairMove — Relatório de Performance

**Data da auditoria:** missão QA autônoma (Área 5 — performance, paginação e ledger).
Todas as medições foram executadas contra o banco real (Postgres 15 + PostGIS),
reproduzíveis com os comandos ao final.

## 1. Sumário executivo

| Problema | Severidade | Estado |
|---|---|---|
| Zero índices secundários — 6 queries quentes em Seq Scan | HIGH | **Corrigido** (9 índices, migração `0006`) |
| Extrato (ledger) sem `ORDER BY` — LIMIT em janela arbitrária | HIGH | **Corrigido** (ordem desc por `created_at, id`) |
| `GET /admin/events` sem `LIMIT` | MEDIUM | **Corrigido** (teto 200) |
| Histórico `limit 100` sem cursor (truncate silencioso do mais antigo) | LOW | **Documentado** (ver §5) |
| Matching sem GiST geoespacial (expressão não indexável como está) | MEDIUM | **Documentado** (ver §6) |

Suíte de regressão: `tests/qa-performance.test.ts` (3 cenários RED→GREEN) —
índices verificados por `pg_indexes` a cada execução.

## 2. Índices (BUG-H2)

### Antes

O banco tinha **apenas PKs e uniques** (48 índices, todos internos do
Postgres/drizzle). Nenhum índice secundário em nenhuma tabela.

Baseline `EXPLAIN ANALYZE` (`/tmp/opencode/qa5_explain_before.log`):

```
history:       Seq Scan on rides                    Execution Time: 2.969 ms
expiry-sweep:  Seq Scan on rides                    Execution Time: 0.144 ms
ledger-tx:     Seq Scan on ledger_transactions      Execution Time: 0.342 ms
matching:      Seq Scan on drivers                  Execution Time: 0.183 ms
fraud:         Seq Scan on fraud_events             Execution Time: 0.063 ms
redemptions:   Seq Scan on promotion_redemptions    Execution Time: 0.069 ms
```

Os tempos são baixos porque as tabelas estão micro (dezenas de linhas) — o custo
real é **escala**: cada corrida, cada cron de expiração (a cada 60 s), cada busca de
motorista e cada extrato varrem a tabela inteira desde sempre.

### Depois — migração `drizzle/0006_qa_secondary_indexes.sql` (aplicada)

```sql
CREATE INDEX "idx_drivers_status_available"    ON drivers                 (status, available);
CREATE INDEX "idx_fraud_events_user_type"      ON fraud_events             (user_id, event_type);
CREATE INDEX "idx_ledger_entries_wallet_created" ON ledger_entries         (wallet_id, created_at);
CREATE INDEX "idx_ledger_tx_wallet_created"    ON ledger_transactions      (wallet_id, created_at);
CREATE INDEX "idx_promotion_redemptions_ride"  ON promotion_redemptions    (ride_id);
CREATE INDEX "idx_ride_location_events_ride"   ON ride_location_events     (ride_id);
CREATE INDEX "idx_rides_passenger_created"     ON rides                    (passenger_id, created_at);
CREATE INDEX "idx_rides_driver_created"        ON rides                    (driver_id, created_at);
CREATE INDEX "idx_rides_status_created"        ON rides                    (status, created_at);
```

Cobertura por carga de trabalho:

| Query | Índice | Motivador |
|---|---|---|
| `GET /rides/history/me` | `idx_rides_passenger_created` (+ driver) | Histórico do usuário `ORDER BY created_at DESC LIMIT 100` |
| Sweep `EXPIRED` (cron 1/min) | `idx_rides_status_created` | `status IN (...) AND created_at < cutoff` |
| Matching (cada busca) | `idx_drivers_status_available` | `status='online' AND available=true` |
| Extrato `transactions`/`entries` | `idx_ledger_tx/entries_wallet_created` | `wallet_id ORDER BY created_at DESC LIMIT n` |
| Scoring de fraude (3 queries/avaliação) | `idx_fraud_events_user_type` | `user_id + event_type` |
| `releaseRedemptions` / `applyPromotion` | `idx_promotion_redemptions_ride` | `ride_id` (FK sem índice automático) |
| Feed de localização da corrida | `idx_ride_location_events_ride` | `ride_id` |

### Prova de caminho (planner escolhe os índices)

Com as tabelas micro, o planner **corretamente** ainda escolhe Seq Scan (menor
custo). Forçando a troca (`SET enable_seqscan TO off`) para demonstrar que cada
índice serve exatamente sua query (`qa5_explain_index_proof.log`):

```
history:       Index Scan Backward using idx_rides_passenger_created
expiry-sweep:  Bitmap Index Scan on idx_rides_status_created
ledger-tx:     Index Scan Backward using idx_ledger_tx_wallet_created
matching:      Index Scan using idx_drivers_status_available
redemptions:   Index Scan using idx_promotion_redemptions_ride
location:      Index Scan using idx_ride_location_events_ride
```

Pós-fix (`qa5_explain_after.log`): `fraud` já migrou espontaneamente para
`Index Scan using idx_fraud_events_user_type`; demais trocam sozinhos quando o
volume crescer (a partir de ~tabelas médias o planner passa a preferir índice).

## 3. Paginação e limites de listagem (BUG-H1/H3)

### Corrigido — extrato sem `ORDER BY`

`GET /api/wallets/:userId/transactions` (`LIMIT 200`) e `/:userId/entries`
(`LIMIT 500`) retornavam **ordem física de inserção** — em tabelas com mais linhas
que o teto, o usuário via as transações mais antigas e as novas sumiam.

- RED: `200 linhas | ordenadoDesc=false | primeiro=<mais antigo>`
- Fix: `ORDER BY created_at DESC, id DESC` (desempate determinístico)
- GREEN: `200/500 linhas | ordenadoDesc=true | primeiro=<mais novo>`

### Corrigido — admin events sem teto

`GET /api/events/admin/events` → sem `LIMIT` (RED: 201+ linhas). Agora `LIMIT 200`.

### Limites vigentes (todos com teto, após a correção)

| Endpoint | Teto | Ordenação |
|---|---|---|
| `/rides/history/me` | 100 | `created_at DESC` |
| `/wallets/:id/transactions` | 200 | `created_at DESC, id DESC` |
| `/wallets/:id/entries` | 500 | `created_at DESC, id DESC` |
| `/events/admin/events` | 200 | `created_at DESC` |
| `/matching/drivers/nearby` (admin) | sem teto* | distância ASC (necessário) |

\* o nearby é limitado pelo raio (≤100 km) e hoje retorna poucas dezenas de
motoristas; ver §6 para o gargalo geoespacial real.

## 4. Ledger — integridade

Verificado por execução durante as áreas 3/5:

- Toda mutação de saldo passa por `walletEngine` (débito/crédito + `ledger_entries`
  de dupla entrada + `balance_after`) em transação única; property tests existentes
  (`tests/wallet*.test.ts`) seguem verdes (199/199).
- Corrida cancelada **não move dinheiro** (settlement só após claim de COMPLETED —
  BUG-E3) e devolve cupom + slot de campanha (BUG-F2) **na mesma transação**.
- Cobrança de mensalidade: `debitCents(motorista)` + `creditCents(plataforma)` +
  `creditCents(reserva)` idempotentes por `idempotencyKey`.
- Extrato agora ordenado e determinístico (H1).

Pendência de produto (não performance): BUG-C — sem job automático de billing.

## 5. Conhecido e documentado (não corrigido nesta missão)

- **Histórico sem cursor:** `/rides/history/me` entrega só as 100 mais recentes;
  não há `offset/cursor`, então o histórico antigo é inalcançável pela API.
  Hoje aceitável (< 100 corridas por usuário no estágio atual). Recomendação:
  cursor `created_at < last_seen` (keyset pagination) antes de escala.
- **Fraud engine sem limite por janela:** as 3 queries de scoring não filtram por
  tempo; com `idx_fraud_events_user_type` o scan é barato, mas o acúmulo infinito
  de eventos por usuário deve ganhar janela (`created_at > now() - 30d`).

## 6. Geolocalização (matching) — gargalo estrutural

`findNearbyDrivers` calcula a geografia **em expressão**:

```sql
ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, $pickup, $radius)
```

Colunas calculadas não têm índice B-tree/GiST utilizável — mesmo com os índices da
§2, a parte geoespacial é CPU por linha (regex de validação + `ST_MakePoint` +
cast). Com milhares de motoristas isso vira o próximo gargalo.

**Recomendação (próxima iteração):** coluna persistida
`location geography(Point, 4326)` em `drivers`, preenchida em
`updateDriverLocation`, com **GiST** indexado; a query passa a usar
`ST_DWithin(location, $1, radius)` indexado. Requer migração de backfill
(`UPDATE drivers SET location = ST_SetSRID(ST_MakePoint(...),4326)::geography`).

## 7. Custo de cron jobs

| Job | Frequência | Custo antes | Custo agora |
|---|---|---|---|
| RideExpiry (sweep EXPIRED) | `*/1 * * * *` | Seq scan em `rides` | Index `idx_rides_status_created` (bitmap) |
| EventScheduler (leaderboard) | diário 03:00 | Seq scan em `events` | tabela pequena; ok |
| Charge mensalidade | **não existe** (BUG-C) | — | — |

## 8. Como reproduzir as medições

```bash
set -a; source .env; set +a
# baseline/after (substitua os IDs pelos seus)
node -e "const {Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
const r=await c.query(\"EXPLAIN ANALYZE SELECT * FROM rides WHERE status IN ('REQUESTED','SEARCHING') AND created_at < now() - interval '15 minutes'\");
console.log(r.rows.map(x=>x['QUERY PLAN']).join('\n'));await c.end();})()"

# prova de caminho dos índices
# SET enable_seqscan TO off; EXPLAIN <query>; (ver qa5_explain_index_proof.log)

# suíte de regressão de performance
npx jest -w 1 --testTimeout=90000 --forceExit tests/qa-performance.test.ts
```

**Estado final:** suíte completa `199/199` (26 suítes); typecheck/lint/build verdes;
migração `0006` aplicada localmente (`pnpm db:migrate`; CI usa `pnpm db:push`).
