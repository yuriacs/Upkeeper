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
    """
    Tudo o que o servidor tem da conta. O perfil privado vai cifrado: o site (no navegador)
    junta a versão aberta ao arquivo quando o cofre está destrancado.
    """
    from pools.models import OwnedPrecon, UserDeck

    from .serializers import profile_of

    private = profile_of(user)
    entries = DrawEntry.objects.filter(player=user).select_related("draw", "deck", "user_deck")
    return {
        "exported_at": timezone.now().isoformat(),
        "account": {
            "username": user.username,
            "date_joined": user.date_joined.isoformat(),
            "last_login": user.last_login.isoformat() if user.last_login else None,
        },
        "private_profile": {
            "note": "Only you can read this. The server keeps your email as an HMAC fingerprint "
            "and your profile encrypted with a key that never leaves your browser.",
            "email_fingerprint_hmac_sha256": private.email_digest,
            "encrypted_profile_aes_gcm": private.vault or None,
        },
        "linked_accounts": [
            {"provider": a.provider, "linked_at": a.created_at.isoformat()}
            for a in user.social_accounts.all()
        ],
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
                "result": None if e.draw.winner_position is None
                else ("won" if e.draw.winner_position == e.position else "lost"),
            }
            for e in entries
        ],
        "draws_created": list(Draw.objects.filter(created_by=user).values_list("code", flat=True)),
        "friends": _friends_export(user),
        "table_games": _table_games_export(user),
    }


def _table_games_export(user) -> list[dict]:
    """Partidas encerradas em mesas sem sorteio (ranking das mesas)."""
    from tables.models import TableResultEntry

    rows = TableResultEntry.objects.filter(player=user).select_related("result", "deck", "user_deck")
    return [
        {
            "date": r.result.finished_at.isoformat(),
            "deck": (r.deck or r.user_deck).name if (r.deck or r.user_deck) else None,
            "result": "won" if r.won else "lost",
        }
        for r in rows
    ]


def _friends_export(user) -> list[dict]:
    """Amigos e pedidos (só os nomes de usuário, que já são públicos)."""
    from django.db.models import Q

    from .models import Friendship

    out = []
    for r in Friendship.objects.filter(Q(from_user=user) | Q(to_user=user)).select_related("from_user", "to_user"):
        other = r.to_user if r.from_user_id == user.id else r.from_user
        status = "friend" if r.accepted else ("request_sent" if r.from_user_id == user.id else "request_received")
        out.append({"username": other.username, "status": status, "since": (r.accepted_at or r.created_at).isoformat()})
    return out
