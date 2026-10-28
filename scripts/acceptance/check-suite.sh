#!/usr/bin/env bash
# scripts/acceptance/check-suite.sh — 验收套件静态契约与自测的统一门禁入口。
# 本地 gate.sh quick 与 docs-check.sh（CI）共用；全部检查不起 app、不占端口、不碰验收 vault。
set -euo pipefail
cd "$(dirname "$0")/../.."

bash scripts/acceptance/check-syntax.sh
node scripts/acceptance/run.mjs --check
node --test \
  scripts/acceptance/lib/app.test.mjs \
  scripts/acceptance/lib/batches.test.mjs \
  scripts/acceptance/lib/cu.test.mjs \
  scripts/acceptance/lib/drive.test.mjs \
  scripts/acceptance/lib/execute.test.mjs \
  scripts/acceptance/lib/evidence.test.mjs \
  scripts/acceptance/build-bundle.test.mjs \
  scripts/acceptance/coverage.test.mjs
