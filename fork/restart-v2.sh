#!/usr/bin/env bash
# Restart the fork from clean state. Each test run commits real extrinsics.
set -euo pipefail
cd "$(dirname "$0")/.."
# ./fork/restart-v2.sh            Kusama Asset Hub, port 8011
# ./fork/restart-v2.sh polkadot   Polkadot Asset Hub, port 8012
CFG=fork/kusama-asset-hub-v2.yml; [ "${1:-}" = polkadot ] && CFG=fork/polkadot-asset-hub-v2.yml
LOG=/dev/shm/chopsticks-decision-deposit-v2-$(basename $CFG .yml).log
for pid in $(pgrep -f "^node .*chopsticks --config $CFG" || true); do kill "$pid" 2>/dev/null || true; done
sleep 2
setsid nohup node node_modules/.bin/chopsticks --config $CFG > "$LOG" 2>&1 < /dev/null &
for _ in $(seq 1 120); do
  if grep -q 'listening' "$LOG" 2>/dev/null; then tail -1 "$LOG"; exit 0; fi
  sleep 1
done
echo "chopsticks did not come up; see $LOG" >&2; tail -20 "$LOG" >&2; exit 1
