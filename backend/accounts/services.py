"""Exclusão e exportação de dados pessoais (LGPD)."""

from django.db import transaction
from django.utils import timezone

from decks.models import Draw, DrawEntry

DELETED_NAME = "(conta excluída)"


@transaction.atomic
def delete_account(user):
    """
    Apaga a conta e o que é dela (decks montados, precons marcados, token, lugares em salas).
    Sorteios antigos de outras pessoas continuam existindo, mas sem o nome nem o vínculo.
    """
    from rooms.models import Room, RoomPlayer
    from rooms.services import leave_room

    DrawEntry.objects.filter(player=user).update(player_name=DELETED_NAME)
    for player in RoomPlayer.objects.filter(user=user).select_related("room"):
        leave_room(player)
    Room.objects.filter(players__isnull=True).delete()  # salas que ficaram vazias
    user.delete()  # o resto cai por CASCADE / SET_NULL nos modelos


def export_account(user) -> dict:
    from pools.models import OwnedPrecon, UserDeck

    entries = DrawEntry.objects.filter(player=user).select_related("draw", "deck", "user_deck")
    return {
        "exported_at": timezone.now().isoformat(),
        "account": {
            "username": user.username,
            "email": user.email,
            "date_joined": user.date_joined.isoformat(),
            "last_login": user.last_login.isoformat() if user.last_login else None,
        },
        "owned_precons": list(OwnedPrecon.objects.filter(user=user).values_list("deck__name", flat=True)),
        "decks": [
            {"name": d.name, "decklist": d.decklist_text, "created_at": d.created_at.isoformat()}
            for d in UserDeck.objects.filter(owner=user)
        ],
        "draws_received": [
            {
                "draw": e.draw.code,
                "date": e.draw.created_at.isoformat(),
                "deck": (e.deck or e.user_deck).name if (e.deck or e.user_deck) else None,
            }
            for e in entries
        ],
        "draws_created": list(Draw.objects.filter(created_by=user).values_list("code", flat=True)),
    }
