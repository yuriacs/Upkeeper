"""Exclusão e exportação de dados pessoais (LGPD)."""

from django.db import transaction
from django.utils import timezone

from decks.models import Draw, DrawEntry

DELETED_NAME = "(conta excluída)"


@transaction.atomic
def _forget_in_replays(user):
    """Partidas para rever dos outros jogadores: o nome de quem excluiu a conta vira DELETED_NAME."""
    import json
    import zlib

    from tables.models import GameReplay

    def scrub(value):
        if isinstance(value, dict):
            return {k: scrub(v) for k, v in value.items()}
        if isinstance(value, list):
            return [scrub(v) for v in value]
        return DELETED_NAME if value == user.username else value

    for row in GameReplay.objects.filter(players__user=user):
        data = scrub(json.loads(zlib.decompress(bytes(row.data))))
        for p in data.get("players", []):
            if p.get("user") == user.pk:
                p["user"] = None
        row.data = zlib.compress(json.dumps(data, separators=(",", ":")).encode(), 6)
        row.save(update_fields=["data"])


def delete_account(user):
    """
    Apaga a conta e o que é dela (decks montados, precons marcados, token, lugares em salas).
    Sorteios antigos de outras pessoas continuam existindo, mas sem o nome nem o vínculo.
    """
    from rooms.models import Room, RoomPlayer
    from rooms.services import leave_room

    DrawEntry.objects.filter(player=user).update(player_name=DELETED_NAME)
    _forget_in_replays(user)
    for player in RoomPlayer.objects.filter(user=user).select_related("room"):
        leave_room(player)
    Room.objects.filter(players__isnull=True).delete()  # salas que ficaram vazias
    user.delete()  # o resto cai por CASCADE / SET_NULL nos modelos


def _supporter_export(user):
    from .supporter import info

    data = info(user)
    if not data["ever"]:
        return None
    keys = ("until", "sleeve", "on_wall", "playmat", "total_cents", "founder", "in_credits", "sleeve_image", "foil",
            "frame", "title")
    return {k: data[k] for k in keys}


def _donation_export(user):
    from .models import DonationClaim
    from .supporter import claim_info

    row = DonationClaim.objects.filter(user=user).select_related("gift_to").first()
    return claim_info(row) if row else None


def export_account(user) -> dict:
    """
    Tudo o que o servidor tem da conta. O perfil privado vai cifrado: o site (no navegador)
    junta a versão aberta ao arquivo quando o cofre está destrancado.
    """
    from pools.models import CardArt, FavoriteCard, OwnedPrecon, UserDeck
    from pools.services.card_art import art_url, token_arts

    from tables.models import PlayTime

    from .avatar import avatar_url

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
        "favorite_cards": [str(i) for i in FavoriteCard.objects.filter(user=user).values_list("oracle_id", flat=True)],
        "card_arts": [
            art_url(k) for k in CardArt.objects.filter(owner=user, kind=CardArt.ART).values_list("key", flat=True)
        ],
        "custom_tokens": [
            {"name": name, "power": power, "toughness": toughness, "image": art_url(key)}
            for key, name, power, toughness in CardArt.objects.filter(owner=user, kind=CardArt.TOKEN).values_list(
                "key", "name", "power", "toughness"
            )
        ],
        "token_arts": token_arts(user),
        "avatar": avatar_url(user),
        "supporter": _supporter_export(user),
        "donation_claim": _donation_export(user),
        "seconds_played": PlayTime.objects.filter(user=user).values_list("seconds", flat=True).first() or 0,
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
