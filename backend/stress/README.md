# Teste de carga da mesa virtual

Mede quantas mesas o servidor aguenta: abre mesas de 4 jogadores falsos que jogam como gente
(comprar, baixar carta, virar, vida, marcadores, organizar, chat…) e aumenta o número de mesas
em etapas, medindo quanto tempo cada ação leva para voltar.

| Arquivo | Para quê |
| --- | --- |
| `loadtest.py` | os jogadores falsos e o relatório por etapa |
| `run_limited.sh` | sobe o servidor preso a 0,1 CPU e 512 MB (o plano grátis do Render), Linux com root |
| `latency_proxy.py` | atrasa a conexão com um Postgres local, para imitar a distância até o Neon |
| `../tables/management/commands/stress_setup.py` | cria as contas de teste e um precon de 100 cartas |

## Rodar localmente (Linux)

Nunca use o banco de produção: o `stress_setup` cria contas e um deck falsos.

```bash
# 1. Postgres local na porta 5433 + atraso de 20 ms até ele (porta 5434)
python stress/latency_proxy.py --listen 5434 --target 127.0.0.1:5433 --rtt 20 &
export DATABASE_URL=postgres://postgres@127.0.0.1:5434/stress SECRET_KEY=teste DEBUG=0 \
       ALLOWED_HOSTS=127.0.0.1 CORS_ALLOWED_ORIGINS=http://localhost:5199 SECURE_SSL_REDIRECT=0
python manage.py migrate
python manage.py stress_setup --users 240 --out stress_tokens.json --i-know-this-is-not-production

# 2. Servidor com os recursos do plano grátis (sudo, cgroup v1)
sudo -E CPU=0.1 MEM_MB=512 PORT=8000 stress/run_limited.sh &

# 3. Carga: 1 ação a cada 10 s por jogador, de 10 a 50 mesas
python stress/loadtest.py --url ws://127.0.0.1:8000 --origin http://localhost:5199 \
  --tokens stress_tokens.json --steps 10,20,30,40,50 --step-seconds 60 --think 10 \
  --pid <PID do uvicorn> --out stress/results/think10.json
```

Colunas: ações/s (total), latência p50/p95/p99 (ms), erros (ações recusadas pelo jogo, normal:
passar o turno fora da vez…), perdidas (sem resposta em 30 s), quedas (conexões derrubadas),
KB/s recebidos e, com `--pid`, CPU (% de 1 núcleo) e memória do servidor. Para sozinho quando o
p95 passa de 3 s (`--stop-p95`).

## Resultados (14/10/2026, 0,1 CPU, 512 MB, banco a 20 ms)

Ritmo agitado (cada jogador age a cada 4 s em média):

| mesas | ações/s | p50 | p95 | CPU | RAM |
| --- | --- | --- | --- | --- | --- |
| 6 | 5,8 | 3 ms | 6 ms | 2,9% | 100 MB |
| 10 | 9,4 | 3 ms | 11 ms | 4,8% | 139 MB |
| 14 | 13,4 | 4 ms | 84 ms | 7,1% | 174 MB |
| 18 | 18,1 | 738 ms | 2,6 s | 9,8% | 221 MB |

Ritmo normal (a cada 10 s):

| mesas | ações/s | p50 | p95 | CPU | RAM |
| --- | --- | --- | --- | --- | --- |
| 15 | 6,0 | 3 ms | 8 ms | 3,8% | 114 MB |
| 25 | 10,1 | 4 ms | 56 ms | 6,6% | 177 MB |
| 35 | 13,2 | 30 ms | 433 ms | 8,9% | 259 MB |
| 45 | 13,7 | 428 ms | 1,0 s | 9,9% | 335 MB |

O limite é a CPU, em torno de 13 a 14 ações por segundo no total (~7 ms de CPU por ação). Cada
mesa ocupa ~7 MB, então a memória só aperta perto de 60 mesas.
