#!/usr/bin/env bash
# Sobe o servidor (o mesmo comando do Render) preso aos recursos do plano grátis do Render:
# 0,1 de CPU e 512 MB de RAM (cgroup v1; precisa de root, numa máquina Linux de teste).
#
#   CPU=0.1 MEM_MB=512 PORT=8000 DATABASE_URL=postgres://... stress/run_limited.sh
#
# Variáveis: CPU (fração de 1 núcleo; 0 = sem limite), MEM_MB, PORT. O resto (DATABASE_URL, SECRET_KEY...) vem do ambiente.
set -euo pipefail
CPU=${CPU:-0.1}
MEM_MB=${MEM_MB:-512}
PORT=${PORT:-8000}
G=upkeeper-stress
mkdir -p /sys/fs/cgroup/cpu/$G /sys/fs/cgroup/memory/$G
echo 100000 > /sys/fs/cgroup/cpu/$G/cpu.cfs_period_us
# CPU=0: sem limite de CPU (para comparar)
QUOTA=$(python3 -c "print(int($CPU * 100000) if $CPU > 0 else -1)")
[ "$(cat /sys/fs/cgroup/cpu/$G/cpu.cfs_quota_us)" = "$QUOTA" ] || echo "$QUOTA" > /sys/fs/cgroup/cpu/$G/cpu.cfs_quota_us
echo $((MEM_MB * 1024 * 1024)) > /sys/fs/cgroup/memory/$G/memory.limit_in_bytes
echo 0 > /sys/fs/cgroup/memory/$G/memory.swappiness 2>/dev/null || true
echo $$ > /sys/fs/cgroup/cpu/$G/cgroup.procs
echo $$ > /sys/fs/cgroup/memory/$G/cgroup.procs
cd "$(dirname "$0")/.."
exec uvicorn ${APP:-config.asgi:application} --host 127.0.0.1 --port "$PORT" --lifespan off \
  --ws-ping-interval 20 --ws-ping-timeout 20 --no-access-log
