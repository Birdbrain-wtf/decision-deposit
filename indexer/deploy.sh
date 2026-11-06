#!/usr/bin/env bash
# Deploy the pool indexer to Birdbrain's box (ADR 0076). Reads only, holds no key.
set -euo pipefail
cd "$(dirname "$0")"
BOX=${BOX:-root@178.105.162.128}
ssh "$BOX" 'mkdir -p /opt/cdd-indexer /var/lib/cdd-indexer/events && chown -R www-data /var/lib/cdd-indexer'
scp -q indexer.ts package.json "$BOX:/opt/cdd-indexer/"
scp -q cdd-indexer.service "$BOX:/etc/systemd/system/"
ssh "$BOX" 'cd /opt/cdd-indexer && bun install --silent && systemctl daemon-reload && systemctl enable --now cdd-indexer && systemctl restart cdd-indexer && systemctl --no-pager status cdd-indexer | head -5'
