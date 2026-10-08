#!/usr/bin/env bash
# Build no host de deploy (Render: "Build Command" = bash build.sh)
set -o errexit
pip install -r requirements.txt
python manage.py collectstatic --noinput
python manage.py migrate --noinput
