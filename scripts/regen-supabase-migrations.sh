#!/usr/bin/env bash
# Regenerates supabase/migrations/ from the authored, spec-numbered files in
# src/db/migrations/ (0001_extensions.sql .. 0019_verification.sql).
#
# Why two copies: src/db/migrations/ is the human-readable source that
# matches the migration numbering in docs/decisions/physical-schema-rls-erd-v0.1.md
# Section 16 1:1. The Supabase CLI (`supabase db push`) only picks up files
# under supabase/migrations/ named <14-digit-timestamp>_<name>.sql, so this
# script copies them across with synthetic sequential timestamps, preserving
# exact order and content. ALWAYS edit src/db/migrations/ and re-run this
# script — never hand-edit a file under supabase/migrations/ directly, or
# the two will drift.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -f supabase/migrations/*.sql
i=1
ts_base=20261001000000
for f in $(ls src/db/migrations/*.sql | sort); do
  base="$(basename "$f")"
  name="${base#????_}"
  name="${name%.sql}"
  ts=$(printf "%014d" $((ts_base + i)))
  cp "$f" "supabase/migrations/${ts}_${name}.sql"
  i=$((i+1))
done
echo "Regenerated $((i-1)) files in supabase/migrations/ from src/db/migrations/."
