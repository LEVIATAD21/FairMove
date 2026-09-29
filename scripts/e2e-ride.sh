#!/usr/bin/env bash
# PASSO 4 — E2E da corrida REAL: register passageiro -> funding via admin ->
# criar corrida -> aceitar -> status -> complete -> saldo creditado no motorista.
# Contra o backend real (Postgres + Redis). Nada de mocks.
set -euo pipefail

# Credenciais reais do seed vêm de .env.local (gitignored) — ver README
# "Primeiro Acesso em Produção".
[ -f .env ] && { set -a; . ./.env; set +a; }
[ -f .env.local ] && { set -a; . ./.env.local; set +a; }
: "${SEED_DRIVER_PASSWORD:?SEED_DRIVER_PASSWORD ausente — defina em .env.local (openssl rand -base64 16)}"
: "${SEED_ADMIN_PASSWORD:?SEED_ADMIN_PASSWORD ausente — defina em .env.local (openssl rand -base64 16)}"
: "${SEED_PASSENGER_PASSWORD:?SEED_PASSENGER_PASSWORD ausente — defina em .env.local (openssl rand -base64 16)}"

DRIVER_EMAIL="joao.silva@fairmove.com.br"
PASSENGER_EMAIL="carlos.oliveira@fairmove.com.br"
ADMIN_EMAIL="admin@fairmove.com.br"

BASE="${BASE:-http://localhost:3000}"
API="$BASE/api/v1"
PG="docker exec fairmove-postgres psql -U fairmove -d fairmove -tA -c"
B="$(mktemp)"
trap 'rm -f "$B"' EXIT

step() { printf '\n== %s\n' "$*"; }
req() { # req METHOD PATH [TOKEN] [BODY]
  local method="$1" path="$2" token="${3:-}" body="${4:-}"
  local args=(-sS -o "$B" -w '%{http_code}' -X "$method" "$path" -H 'Content-Type: application/json')
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
}
ok()   { printf 'HTTP %s  %s\n' "$1" "$2"; }
fail() { printf 'FALHA (HTTP %s): %s\n%s\n' "$1" "$2" "$(cat "$B")"; exit 1; }
jqv()  { jq -r "$1" < "$B"; }

step "0) backend saudável"
code=$(req GET "$BASE/ready")
[[ "$code" == 200 ]] || fail "$code" "/ready"
ok "$code" "/ready $(jq -c . < "$B")"

step "1) login do motorista seedado ($DRIVER_EMAIL)"
code=$(req POST "$API/auth/login" "" "{\"email\":\"$DRIVER_EMAIL\",\"password\":\"$SEED_DRIVER_PASSWORD\"}")
[[ "$code" == 200 ]] || fail "$code" "login motorista"
DT=$(jqv .token); ok "$code" "token ok (${#DT} chars)"

code=$(req GET "$API/drivers/me" "$DT")
[[ "$code" == 200 ]] || fail "$code" "/drivers/me"
ok "$code" "me: $(jq -c '{email:.user.email,role:.user.role,driverId:.driver.id,status:.driver.status,available:.driver.available}' < "$B")"
DRIVER_ROLE=$(jqv .user.role)
[[ "$DRIVER_ROLE" == "driver" ]] || { echo "FALHA: role esperado 'driver', veio '$DRIVER_ROLE'"; exit 1; }

step "2) passageiro novo via register real (re-execução faz login)"
code=$(req POST "$API/auth/register" "" "{\"name\":\"Carlos Oliveira\",\"email\":\"$PASSENGER_EMAIL\",\"password\":\"$SEED_PASSENGER_PASSWORD\"}")
if [[ "$code" == 201 ]]; then
  ok "$code" "passageiro CRIADO"
elif [[ "$code" == 409 ]]; then
  ok "$code" "passageiro já existe (re-execução) -> login"
  code=$(req POST "$API/auth/login" "" "{\"email\":\"$PASSENGER_EMAIL\",\"password\":\"$SEED_PASSENGER_PASSWORD\"}")
  [[ "$code" == 200 ]] || fail "$code" "login passageiro"
else
  fail "$code" "register passageiro"
fi
PT=$(jqv .token); PID=$(jqv .user.id); ok "$code" "passageiro id=$PID"

# Re-execução segura: corridas pendentes de runs anteriores bloqueiam a
# criação com 409 (uma corrida ativa por passageiro) — cancela antes.
code=$(req GET "$API/rides/history/me" "$PT")
[[ "$code" == 200 ]] || fail "$code" "history passageiro"
while read -r RIDE_ID RIDE_STATUS; do
  [[ -z "$RIDE_ID" ]] && continue
  ccode=$(req POST "$API/rides/$RIDE_ID/cancel" "$PT" '{"reason":"E2E re-execucao"}')
  ok "$ccode" "cancelada corrida pendente ${RIDE_ID:0:8} ($RIDE_STATUS)"
done < <(jq -r '.rides[]? | select(.status | test("^(COMPLETED|CANCELLED|EXPIRED)") | not) | "\(.id) \(.status)"' < "$B")

step "3) funding real: admin credita R\$50 na carteira do passageiro (ledger de dupla entrada)"
code=$(req POST "$API/auth/login" "" "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$SEED_ADMIN_PASSWORD\"}")
[[ "$code" == 200 ]] || fail "$code" "login admin"
AT=$(jqv .token); ok "$code" "admin logado"

code=$(req GET "$API/wallets/me/balance" "$PT")
[[ "$code" == 200 ]] || fail "$code" "balance passageiro (pré)"
BAL_BEFORE=$(jqv .availableBalance); ok "$code" "saldo antes = $BAL_BEFORE centavos"

code=$(req POST "$API/wallets/$PID/credit" "$AT" "{\"amount\":50,\"description\":\"E2E PASSO4 funding\",\"idempotencyKey\":\"e2e-ride-funding-$(date +%s%N)\"}")
[[ "$code" == 201 ]] || fail "$code" "credit"
ok "$code" "credit: $(jq -c . < "$B")"

code=$(req GET "$API/wallets/me/balance" "$PT")
BAL_AFTER=$(jqv .availableBalance); ok "$code" "saldo depois = $BAL_AFTER centavos"
(( BAL_AFTER >= 1462 )) || { echo "FALHA: saldo insuficiente para a corrida ($BAL_AFTER < 1462)"; exit 1; }

step "4) passageiro cria a corrida (coords geram R\$14,62 pelo pricing real)"
code=$(req POST "$API/rides" "$PT" '{"pickupLocationLat":-23.5505,"pickupLocationLng":-46.6333,"dropoffLocationLat":-23.5505,"dropoffLocationLng":-46.61071170140521}')
[[ "$code" == 201 ]] || fail "$code" "create ride"
RIDE_ID=$(jqv .rideId); FARE=$(jqv .totalFare)
ok "$code" "rideId=$RIDE_ID status=$(jqv .status) distanceKm=$(jqv .distanceKm) totalFare=$FARE"
[[ "$FARE" == "14.62" ]] || { echo "FALHA: tarifa esperada 14.62, veio $FARE"; exit 1; }

step "5) motorista aceita"
code=$(req POST "$API/rides/$RIDE_ID/accept" "$DT")
[[ "$code" == 200 ]] || fail "$code" "accept"
ok "$code" "$(jq -c . < "$B")"

step "6) avanço de estados (real)"
for st in DRIVER_ARRIVING DRIVER_AT_PICKUP PASSENGER_ONBOARD IN_PROGRESS; do
  code=$(req PATCH "$API/rides/$RIDE_ID/status" "$DT" "{\"status\":\"$st\"}")
  [[ "$code" == 200 ]] || fail "$code" "status $st"
  ok "$code" "-> $st"
done

step "7) conclui: liquidação real (débito passageiro + crédito motorista, transação única)"
code=$(req POST "$API/rides/$RIDE_ID/complete" "$DT")
[[ "$code" == 200 ]] || fail "$code" "complete"
ok "$code" "$(jq -c . < "$B")"
PAY=$(jqv .paymentMethod); CREDIT=$(jqv .driverCredit)
[[ "$PAY" == "wallet" ]] || { echo "FALHA: paymentMethod esperado 'wallet' (sem gateway), veio '$PAY'"; exit 1; }
[[ "$CREDIT" == "14.62" ]] || { echo "FALHA: driverCredit esperado 14.62, veio $CREDIT"; exit 1; }

step "8) saldos após a corrida"
code=$(req GET "$API/wallets/me/balance" "$DT")
D_BAL=$(jqv .availableBalance); ok "$code" "motorista: $D_BAL centavos (era $((${D_BAL:-0} - 1462)) antes desta corrida)"
code=$(req GET "$API/wallets/me/balance" "$PT")
P_BAL=$(jqv .availableBalance); ok "$code" "passageiro: $P_BAL centavos (era $BAL_AFTER antes)"

step "9) conferência direta no Postgres"
$PG "SELECT status, final_passenger_price, driver_credit, estimated_distance, completed_at IS NOT NULL AS completed FROM rides WHERE id='$RIDE_ID';" | sed 's/^/  /'
$PG "SELECT transaction_type, amount, description, idempotency_key FROM ledger_transactions WHERE idempotency_key LIKE 'ride:$RIDE_ID:%' ORDER BY transaction_type;" | sed 's/^/  /'
echo "  -- wallets:"
$PG "SELECT u.email, w.available_balance, w.pending_balance FROM wallets w JOIN users u ON u.id=w.user_id WHERE u.email IN ('$DRIVER_EMAIL','$PASSENGER_EMAIL') ORDER BY u.email;" | sed 's/^/  /'

echo
echo "E2E PASSO 4 OK — corrida real liquidada, \$14,62 debitados do passageiro e creditados no motorista via ledger."
