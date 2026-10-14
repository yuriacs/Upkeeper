"""
Prepara um banco para o teste de carga da mesa virtual (backend/stress/loadtest.py): um precon de
100 cartas parecido com os de verdade e N contas de teste com token.

    python manage.py stress_setup --users 200 --out stress_tokens.json

Só para um banco de teste (local). NÃO rode no banco de produção: cria contas e um deck falsos.
`--clean` apaga o que este comando criou.
"""

import json
import uuid

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from rest_framework.authtoken.models import Token

from decks.models import Card, Deck, DeckCard, Edition

PREFIX = "stress_"
DECK_SLUG = "stress-precon"
EDITION = "STRS"

# Lista parecida com a de um precon: comandante, 37 terrenos, criaturas, artefatos...
BASICS = ["Plains", "Island", "Swamp", "Mountain", "Forest"]
KINDS = [
    # (quantas cartas diferentes, tipo, força, resistência)
    (28, "Creature — Human Soldier", "3", "3"),
    (9, "Artifact", "", ""),
    (7, "Enchantment", "", ""),
    (7, "Instant", "", ""),
    (6, "Sorcery", "", ""),
    (1, "Legendary Planeswalker — Test", "", ""),
    (3, "Artifact — Equipment", "", ""),
    (1, "Enchantment — Aura", "", ""),
]


def _image() -> str:
    u = uuid.uuid4()
    return f"https://cards.scryfall.io/normal/front/{str(u)[0]}/{str(u)[1]}/{u}.jpg?1710000000"


class Command(BaseCommand):
    help = "Cria contas de teste e um precon de 100 cartas para o teste de carga da mesa (só banco de teste)."

    def add_arguments(self, parser):
        parser.add_argument("--users", type=int, default=200)
        parser.add_argument("--out", default="stress_tokens.json")
        parser.add_argument("--clean", action="store_true", help="apaga as contas e o deck de teste")
        parser.add_argument("--i-know-this-is-not-production", action="store_true", dest="confirmed")

    def handle(self, users, out, clean, confirmed, **_):
        engine = settings.DATABASES["default"]["ENGINE"]
        if not settings.DEBUG and not confirmed:
            raise CommandError(
                "DEBUG está desligado (parece produção). Este comando cria contas e um deck falsos; "
                "use --i-know-this-is-not-production se este for mesmo um banco de teste."
            )
        User = get_user_model()
        if clean:
            with transaction.atomic():
                n = User.objects.filter(username__startswith=PREFIX).delete()[0]
                DeckCard.objects.filter(deck__slug=DECK_SLUG).delete()
                Deck.objects.filter(slug=DECK_SLUG).delete()
                Card.objects.filter(set_code=EDITION).delete()
                Edition.objects.filter(code=EDITION).delete()
            self.stdout.write(f"Apagado ({n} objetos de conta).")
            return

        with transaction.atomic():
            edition, _ = Edition.objects.get_or_create(code=EDITION, defaults={"name": "Stress Test"})
            if not Deck.objects.filter(slug=DECK_SLUG).exists():
                self._deck(edition)
            tokens = []
            existing = {u.username: u for u in User.objects.filter(username__startswith=PREFIX)}
            for i in range(users):
                name = f"{PREFIX}{i:04d}"
                user = existing.get(name) or User.objects.create_user(name, password=None)
                token, _ = Token.objects.get_or_create(user=user)
                tokens.append({"id": user.id, "name": name, "token": token.key})
        with open(out, "w") as f:
            json.dump({"deck": DECK_SLUG, "users": tokens}, f)
        self.stdout.write(f"{len(tokens)} contas e o deck '{DECK_SLUG}' prontos ({engine}). Tokens em {out}.")

    def _deck(self, edition):
        def card(name, type_line, power="", toughness="", loyalty=""):
            return Card.objects.create(
                scryfall_id=uuid.uuid4(),
                name=name,
                type_line=type_line,
                oracle_text="Texto de teste. " * 8,
                power=power,
                toughness=toughness,
                loyalty=loyalty,
                set_code=EDITION,
                image_normal=_image(),
                image_small=_image(),
            )

        deck = Deck.objects.create(name="Stress Precon", slug=DECK_SLUG, edition=edition, is_active=False)
        DeckCard.objects.create(
            deck=deck, card=card("Stress Commander", "Legendary Creature — Angel", "4", "4"), is_commander=True
        )
        for k, basic in enumerate(BASICS):
            DeckCard.objects.create(deck=deck, card=card(basic, f"Basic Land — {basic}"), quantity=5)
        for i in range(12):
            DeckCard.objects.create(deck=deck, card=card(f"Stress Land {i}", "Land"))
        for n, type_line, p, t in KINDS:
            for i in range(n):
                loyalty = "4" if "Planeswalker" in type_line else ""
                DeckCard.objects.create(
                    deck=deck, card=card(f"Stress {type_line.split()[0]} {i}", type_line, p, t, loyalty)
                )
        total = sum(dc.quantity for dc in deck.deck_cards.all())
        if total != 100:
            raise CommandError(f"o deck de teste ficou com {total} cartas (esperado 100)")
