"""
Perfil público de um jogador (/u/<nome>): decks montados, partidas e vitórias, comandantes mais
jogados e conquistas simples. Só o que já é público no site (nome de usuário, decks, resultados que
aparecem nos rankings); nada do perfil privado (cofre) nem do e-mail.
"""

from collections import Counter

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from decks.services.stats import WON, finished_entries

from .friends import friend_ids

User = get_user_model()
CACHE_SECONDS = 60
TOP_COMMANDERS = 6

# Conquistas contadas na hora: chave, o que é contado e quanto precisa (o frontend dá nome e
# ícone). As que dependem da mesa, do sorteio e das salas ficam guardadas (achievements/catalog.py)
# e vêm depois destas; as duas listas têm "shuffle_up" e "deckbuilders_pride", que valem pelo que
# já existe (contas antigas) ou pelo que foi guardado.
ACHIEVEMENTS = [
    ("first_game", "games", 1),
    ("regular", "games", 10),
    ("veteran", "games", 50),
    ("first_win", "wins", 1),
    ("champion", "wins", 10),
    ("legend", "wins", 50),
    ("deckbuilders_pride", "decks", 1),
    ("shuffle_up", "draws", 1),
    ("architect", "decks", 5),
    ("collector", "precons", 10),
    ("explorer", "commanders", 10),
    ("social", "friends", 3),
]


def _games(user):
    """Partidas terminadas da conta: sorteios (com resultado) e mesas sem sorteio."""
    from tables.models import TableResultEntry

    draws = finished_entries().filter(player=user).select_related(
        "deck__face_commander", "user_deck__face_commander"
    )
    tables = TableResultEntry.objects.filter(player=user).select_related(
        "deck__face_commander", "user_deck__face_commander"
    )
    won_draws = set(finished_entries().filter(player=user).filter(WON).values_list("id", flat=True))
    rows = [(e, e.id in won_draws) for e in draws] + [(e, e.won) for e in tables]
    return rows


def _commander(entry):
    deck = entry.deck or entry.user_deck
    return deck.face_commander if deck else None


def build_profile(user) -> dict:
    from achievements.catalog import GOALS, HOUR
    from achievements.services import progress_for
    from decks.models import Draw
    from pools.models import OwnedPrecon, UserDeck
    from pools.serializers import UserDeckSummarySerializer
    from tables.models import PlayTime

    rows = _games(user)
    games = len(rows)
    wins = sum(1 for _, won in rows if won)
    played: Counter = Counter()
    won_with: Counter = Counter()
    cards = {}
    for entry, won in rows:
        card = _commander(entry)
        if card is None:
            continue
        played[card.name] += 1
        won_with[card.name] += int(won)
        cards[card.name] = card
    commanders = [
        {
            "name": name,
            "image": cards[name].image_art_crop or cards[name].image_normal,
            "games": n,
            "wins": won_with[name],
        }
        for name, n in played.most_common(TOP_COMMANDERS)
    ]
    decks = UserDeck.objects.filter(owner=user).select_related("owner", "face_commander").order_by("-updated_at")
    precons = OwnedPrecon.objects.filter(user=user).count()
    counts = {
        "games": games,
        "wins": wins,
        "decks": decks.count(),
        "precons": precons,
        "commanders": len(played),
        "friends": len(friend_ids(user.id)),
        "draws": Draw.objects.filter(created_by=user).count(),
    }
    stored = progress_for(user.id)
    achievements = []
    for key, what, need in ACHIEVEMENTS:
        progress, earned = stored.get(key, (0, False))
        achievements.append(
            {"key": key, "earned": earned or counts[what] >= need, "progress": min(max(counts[what], progress), need), "goal": need}
        )
    listed = {a["key"] for a in achievements}
    for key, goal in GOALS.items():
        if key in listed:
            continue
        progress, earned = stored.get(key, (0, False))
        if key == "voyeur":  # guardado em segundos, mostrado em horas
            progress, goal = progress // HOUR, goal // HOUR
        achievements.append({"key": key, "earned": earned, "progress": min(progress, goal), "goal": goal})
    from .avatar import avatar_url
    from .supporter import public

    return {
        "username": user.username,
        "avatar": avatar_url(user),
        **public(user),  # supporter, founder, title, frame
        "joined": user.date_joined.date().isoformat(),
        "stats": {
            "games": games,
            "wins": wins,
            # Horas jogadas (segundos): soma da duração das partidas na mesa virtual
            "seconds_played": PlayTime.objects.filter(user=user).values_list("seconds", flat=True).first() or 0,
            "win_rate": round(wins / games, 4) if games else 0.0,
            "decks": counts["decks"],
            "precons": precons,
            "commanders": counts["commanders"],
        },
        "commanders": commanders,
        "decks": UserDeckSummarySerializer(decks[:24], many=True).data,
        "achievements": achievements,
    }


@api_view(["GET"])
@permission_classes([AllowAny])
def public_profile(request, username: str):
    """Perfil público pelo nome de usuário (sem diferenciar maiúsculas)."""
    user = User.objects.filter(username__iexact=username.strip()[:150], is_active=True).first()
    if user is None:
        return Response({"detail": "not_found"}, status=status.HTTP_404_NOT_FOUND)
    key = f"profile:{user.pk}"
    data = cache.get(key)
    if data is None:
        data = build_profile(user)
        cache.set(key, data, CACHE_SECONDS)
    return Response(data)
