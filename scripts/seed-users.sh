#!/usr/bin/env bash
#
# Seed the four Westchase users against a RUNNING local dev server.
#
# New auth model (see src/lib/auth.ts + src/server/index.ts):
#   - The FIRST public sign-up bootstraps the system and is auto-promoted to
#     "admin". After that, public sign-up is closed (403).
#   - Every other user is created by the admin via POST /api/users (which sets
#     their role directly). A fresh account otherwise defaults to "pending"
#     (no access).
#
# This script therefore:
#   1. Signs up Will as the first user (-> becomes admin) and keeps his session
#      cookie.
#   2. Uses Will's admin session to create Leo (office), Regi (technician),
#      Rubem (estimator) through POST /api/users.
#
# Prereqs: a local server running (default http://127.0.0.1:8787) with a fresh
# (empty user table) D1. Re-running against a DB that already has users will
# 403 on step 1 -- reset the auth tables first (see README / db:migrate:local).
#
# Usage:
#   bash scripts/seed-users.sh                 # default base URL + passwords
#   BASE_URL=http://127.0.0.1:8787 bash scripts/seed-users.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
# Dev-only default passwords. Override via env for anything shared.
WILL_PW="${WILL_PW:-Passw0rd!admin}"
LEO_PW="${LEO_PW:-Passw0rd!office}"
REGI_PW="${REGI_PW:-Passw0rd!tech}"
RUBEM_PW="${RUBEM_PW:-Passw0rd!estimator}"

COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

say() { printf '\n\033[1;36m==>\033[0m %s\n' "$1"; }

# ── 1. Bootstrap: first signup -> admin (Will) ──────────────────────
say "Bootstrapping first admin: Will (willbham16@gmail.com)"
SIGNUP_RES="$(curl -sS -c "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Will\",\"email\":\"willbham16@gmail.com\",\"password\":\"$WILL_PW\"}")"
echo "  signup response: $SIGNUP_RES"

# ── 2. Admin creates the other three via POST /api/users ────────────
create_user() {
  local name="$1" email="$2" password="$3" role="$4"
  say "Creating $role: $name ($email)"
  local res
  res="$(curl -sS -b "$COOKIE_JAR" -X POST "$BASE_URL/api/users" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"$name\",\"email\":\"$email\",\"password\":\"$password\",\"role\":\"$role\"}")"
  echo "  response: $res"
}

create_user "Leo"   "leo@nobletampa.com"   "$LEO_PW"   "office"
create_user "Regi"  "regi@nobletampa.com"  "$REGI_PW"  "technician"
create_user "Rubem" "rubem@nobletampa.com" "$RUBEM_PW" "estimator"

# ── 3. Verify ───────────────────────────────────────────────────────
say "Current users (via admin GET /api/users):"
curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/users"
echo

say "Done. Sign-in credentials (dev):"
cat <<EOF
  Will  (admin)      willbham16@gmail.com  / $WILL_PW
  Leo   (office)     leo@nobletampa.com    / $LEO_PW
  Regi  (technician) regi@nobletampa.com   / $REGI_PW
  Rubem (estimator)  rubem@nobletampa.com  / $RUBEM_PW
EOF
