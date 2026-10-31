#!/usr/bin/env bash
# Build no host de deploy (Render: "Build Command" = bash build.sh)
# Só o essencial: as sincronizações com o Spellbook e o Scryfall (manage.py run_syncs) rodam
# depois que o servidor sobe, num processo à parte (config/syncs.py), e não atrasam o deploy.
set -o errexit
export PYTHONUNBUFFERED=1  # o log do deploy mostra o progresso na hora
pip install -r requirements.txt
python manage.py collectstatic --noinput
python manage.py migrate --noinput
python manage.py rebuild_ranking  # rápido: só soma as partidas
