#!/usr/bin/env bash
# Install the pool backstop on Birdbrain's box. The key only pays fees.
set -euo pipefail
cd "$(dirname "$0")"
BOX=${BOX:-root@178.105.162.128}
ssh -o BatchMode=yes "$BOX" 'mkdir -p /opt/cdd-settle && chmod 700 /opt/cdd-settle'
scp -q settle.ts package.json "$BOX:/opt/cdd-settle/"
scp -q /home/workspace/infra/secrets/birdbrain-evm/kusama-deployer.key "$BOX:/opt/cdd-settle/kusama-fees.key"
scp -q cdd-settle.service cdd-settle.timer "$BOX:/etc/systemd/system/"
ssh -o BatchMode=yes "$BOX" 'chmod 600 /opt/cdd-settle/kusama-fees.key && cd /opt/cdd-settle && bun install --silent && systemctl daemon-reload && systemctl enable --now cdd-settle.timer && systemctl list-timers cdd-settle.timer --no-pager | head -3 && bun settle.ts kusama 0xfcd8058e46b8ac6f02f1cc71e2912c5ffdc095ce /opt/cdd-settle/kusama-fees.key --dry-run'
