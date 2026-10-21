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
# Decks montados com edição em phyrexiano (texto ilegível): passam para a inglesa mais barata
python manage.py fix_phyrexian_prints || true
# Preço das cartas (valor estimado dos decks): as que estão há mais de 7 dias sem atualizar, até
# 1000 cartas por deploy (as mais velhas primeiro; ~2 min pelo limite da busca do Scryfall)
python manage.py sync_prices --older-than 7 --max-cards 1000 || true
