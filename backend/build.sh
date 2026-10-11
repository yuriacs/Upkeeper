#!/usr/bin/env bash
# Build no host de deploy (Render: "Build Command" = bash build.sh)
set -o errexit
pip install -r requirements.txt
python manage.py collectstatic --noinput
python manage.py migrate --noinput
# Bracket estimado dos decks novos (e revisão mensal, caso a lista de Game Changers mude).
# Se o Commander Spellbook estiver fora do ar, o build segue normalmente.
python manage.py estimate_brackets --older-than 30 || true
# Função das cartas (tutor, ramp, compra...) do Scryfall, uma vez por mês, e nível de poder dos decks
python manage.py sync_card_tags --older-than 30 || true
python manage.py analyze_decks --missing || true
# Força/resistência e lealdade das cartas (mesa virtual): só as que ainda não têm
python manage.py sync_scryfall --stats || true
