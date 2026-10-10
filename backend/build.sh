#!/usr/bin/env bash
# Build no host de deploy (Render: "Build Command" = bash build.sh)
set -o errexit
pip install -r requirements.txt
python manage.py collectstatic --noinput
python manage.py migrate --noinput
# Bracket estimado dos decks novos (e revisão mensal, caso a lista de Game Changers mude).
# Se o Commander Spellbook estiver fora do ar, o build segue normalmente.
python manage.py estimate_brackets --older-than 30 || true
