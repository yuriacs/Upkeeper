"""
Lógica do sorteio: monta o conjunto de decks elegíveis a partir dos filtros e distribui
um deck para cada jogador, respeitando as regras de cor, de coleção e de repetição.

Os dois modos usam a mesma busca com retrocesso (jogador por jogador, sobre a pool
embaralhada), então qualquer restrição por jogador — "não receber o próprio deck",
"não repetir um deck que já jogou" — entra de forma natural.
"""

import random
import secrets
from collections import defaultdict
from dataclasses import dataclass, field

from django.db import transaction
from django.db.models import Q

from ..models import Deck, Draw, DrawEntry

# Regras de cor
COLORS_ANY = "any"
COLORS_DISTINCT = "distinct"  # cada jogador com uma combinação de cores diferente
COLORS_NO_OVERLAP = "no_overlap"  # nenhuma cor em comum entre os decks
COLOR_RULES = [COLORS_ANY, COLORS_DISTINCT, COLORS_NO_OVERLAP]

CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # sem 0/o, 1/l/i para não confundir
MAX_STEPS = 50_000  # limite de tentativas da busca com restrições


class DrawError(Exception):
    """Não há como montar um sorteio com esses filtros."""


# --- Jogadores e histórico -----------------------------------------------------------------

@dataclass
class Seat:
    """Um lugar na mesa. `user` identifica o jogador com conta; sem conta, vale o nome."""

    name: str
    user: object | None = None
    excluded: set = field(default_factory=set)  # chaves de decks que este jogador não pode receber


def history_keys(seat: Seat, *, creator=None, room=None) -> set[tuple[str, int]]:
    """
    Decks que o jogador já recebeu:
    - com conta: em qualquer sorteio dele;
    - sem conta, numa sala: nos sorteios daquela sala com o mesmo nome;
    - sem conta, fora de sala: nos sorteios criados pela mesma conta com o mesmo nome.
    """
    if seat.user is not None:
        qs = DrawEntry.objects.filter(player=seat.user)
    elif room is not None:
        qs = DrawEntry.objects.filter(draw__room=room, player__isnull=True, player_name__iexact=seat.name)
    elif creator is not None:
        qs = DrawEntry.objects.filter(draw__created_by=creator, player__isnull=True, player_name__iexact=seat.name)
    else:
        return set()
    qs = qs.filter(in_history=True)
    return {
        ("precon", d) if d else ("user", u)
        for d, u in qs.values_list("deck_id", "user_deck_id")
        if d or u
    }


def reset_user_history(user) -> int:
    """Zera o histórico de um jogador com conta (e dos nomes avulsos nos sorteios que ele criou)."""
    from django.db.models import Q

    return DrawEntry.objects.filter(
        Q(player=user) | Q(draw__created_by=user, draw__room__isnull=True, player__isnull=True),
        in_history=True,
    ).update(in_history=False)


def reset_room_history(room) -> int:
    """Zera o histórico dos sorteios feitos numa sala (vale para todos os jogadores dela)."""
    return DrawEntry.objects.filter(draw__room=room, in_history=True).update(in_history=False)


def apply_history(seats: list[Seat], filters: dict, *, creator=None, room=None):
    if filters.get("no_repeat"):
        for seat in seats:
            seat.excluded |= history_keys(seat, creator=creator, room=room)


# --- Busca ---------------------------------------------------------------------------------

def _colors_ok(colors: str, chosen_colors: list[str], rule: str) -> bool:
    if rule == COLORS_DISTINCT:
        return colors not in chosen_colors
    if rule == COLORS_NO_OVERLAP:
        return all(not set(colors) & set(c) for c in chosen_colors)
    return True


@dataclass
class Candidate:
    key: tuple[str, int]
    color_identity: str
    deck: Deck | None = None
    user_deck: object | None = None
    owner: object | None = None
    bracket: int | None = None  # bracket estimado; None = ainda não calculado (não restringe)


def _brackets_ok(bracket: int | None, chosen: list[Candidate]) -> bool:
    """Mesa equilibrada: no máximo 1 bracket de diferença entre os decks (os sem bracket não contam)."""
    if bracket is None:
        return True
    known = [c.bracket for c in chosen if c.bracket is not None] + [bracket]
    return max(known) - min(known) <= 1


def assign(
    seats: list[Seat], pool: list[Candidate], rule: str, rng: random.Random, balance: bool = False
) -> list[Candidate] | None:
    """Dá um candidato a cada lugar, sem repetir, respeitando cores, brackets e exclusões de cada jogador."""
    items = pool[:]
    rng.shuffle(items)
    steps = 0

    def allowed(seat: Seat, item: Candidate) -> bool:
        if item.key in seat.excluded:
            return False
        return not (seat.user is not None and item.owner is not None and item.owner.pk == seat.user.pk)

    def search(pos: int, chosen: list[Candidate]) -> list[Candidate] | None:
        nonlocal steps
        if pos == len(seats):
            return chosen
        used = {c.key for c in chosen}
        colors = [c.color_identity for c in chosen]
        for item in items:
            steps += 1
            if steps > MAX_STEPS:
                return None
            if item.key in used or not allowed(seats[pos], item):
                continue
            if balance and not _brackets_ok(item.bracket, chosen):
                continue
            if _colors_ok(item.color_identity, colors, rule):
                found = search(pos + 1, chosen + [item])
                if found:
                    return found
        return None

    return search(0, [])


def _no_combo_message(seats: list[Seat], filters: dict) -> str:
    reasons = []
    if filters.get("color_rule", COLORS_ANY) != COLORS_ANY:
        reasons.append("a regra de cores")
    if filters.get("no_repeat") and any(s.excluded for s in seats):
        reasons.append('"não repetir deck"')
    if filters.get("same_edition"):
        reasons.append('"mesma coleção"')
    if filters.get("bracket_balance"):
        reasons.append('"brackets equilibrados"')
    if not reasons:
        return "Não há decks suficientes para essa mesa."
    return f"Não há decks suficientes para essa mesa com {' e '.join(reasons)}. Tente afrouxar as regras."


# --- Modo precons oficiais -----------------------------------------------------------------

def eligible_decks(filters: dict) -> list[Deck]:
    qs = Deck.objects.filter(is_active=True).select_related("edition", "face_commander")
    if filters.get("deck_slugs"):
        # "Meus decks": o jogador escolheu decks que tem — inclusive versões fora do sorteio geral
        qs = Deck.objects.filter(slug__in=filters["deck_slugs"]).select_related("edition", "face_commander")
    if filters.get("editions"):
        qs = qs.filter(edition__code__in=[c.upper() for c in filters["editions"]])
    if filters.get("year_from"):
        qs = qs.filter(release_date__year__gte=filters["year_from"])
    if filters.get("year_to"):
        qs = qs.filter(release_date__year__lte=filters["year_to"])
    if filters.get("max_bracket"):
        # Decks ainda sem bracket calculado entram (precons quase sempre são 2 ou 3)
        qs = qs.filter(Q(bracket__lte=filters["max_bracket"]) | Q(bracket__isnull=True))
    return list(qs)


def run_draw(seats: int | list[Seat], filters: dict, rng: random.Random | None = None) -> tuple[list[Deck], int]:
    rng = rng or random.SystemRandom()
    if isinstance(seats, int):
        seats = [Seat(name=f"Jogador {i + 1}") for i in range(seats)]
    players = len(seats)
    decks = eligible_decks(filters)
    rule = filters.get("color_rule", COLORS_ANY)
    balance = bool(filters.get("bracket_balance"))

    if len(decks) < players:
        raise DrawError(f"Só {len(decks)} deck(s) atendem aos filtros; são necessários {players}.")

    def candidates(group):
        return [
            Candidate(key=("precon", d.pk), color_identity=d.color_identity, deck=d, bracket=d.bracket) for d in group
        ]

    if filters.get("same_edition"):
        groups: dict[int, list[Deck]] = defaultdict(list)
        for d in decks:
            groups[d.edition_id].append(d)
        options = [g for g in groups.values() if len(g) >= players]
        if not options:
            raise DrawError(f"Nenhuma coleção tem {players} decks que atendam aos filtros.")
        rng.shuffle(options)
        for group in options:
            chosen = assign(seats, candidates(group), rule, rng, balance)
            if chosen:
                return [c.deck for c in chosen], len(decks)
        raise DrawError(_no_combo_message(seats, filters))

    chosen = assign(seats, candidates(decks), rule, rng, balance)
    if not chosen:
        raise DrawError(_no_combo_message(seats, filters))
    return [c.deck for c in chosen], len(decks)


def _new_code() -> str:
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        if not Draw.objects.filter(code=code).exists():
            return code


@transaction.atomic
def create_draw(
    names: list[str],
    filters: dict,
    rng: random.Random | None = None,
    creator=None,
    users: list | None = None,
    room=None,
) -> Draw:
    """`users` (opcional) dá a conta de cada jogador, na mesma ordem dos nomes."""
    users = users or [None] * len(names)
    seats = [Seat(name=n, user=u) for n, u in zip(names, users)]
    apply_history(seats, filters, creator=creator, room=room)
    decks, pool_size = run_draw(seats, filters, rng)
    draw = Draw.objects.create(
        code=_new_code(), filters=filters, pool_size=pool_size, created_by=creator, room=room
    )
    DrawEntry.objects.bulk_create(
        DrawEntry(draw=draw, position=i, player_name=seat.name, player=seat.user, deck=deck)
        for i, (seat, deck) in enumerate(zip(seats, decks))
    )
    return draw


# --- Modo deckpool: decks dos próprios jogadores; ninguém recebe um deck que é seu ---------

# Mantido para quem já usa o nome antigo (testes, shell)
PoolItem = Candidate


def pool_items(players: list, max_bracket: int | None = None) -> list[Candidate]:
    from pools.models import OwnedPrecon, UserDeck

    items = [
        Candidate(
            key=("precon", op.deck.pk), owner=op.user, color_identity=op.deck.color_identity, deck=op.deck,
            bracket=op.deck.bracket,
        )
        for op in OwnedPrecon.objects.filter(user__in=players).select_related("user", "deck")
    ]
    items += [
        Candidate(
            key=("user", ud.pk), owner=ud.owner, color_identity=ud.color_identity, user_deck=ud, bracket=ud.bracket
        )
        for ud in UserDeck.objects.filter(owner__in=players).select_related("owner")
    ]
    if max_bracket:
        items = [i for i in items if i.bracket is None or i.bracket <= max_bracket]
    # O mesmo precon pode estar na pool de duas pessoas: vale uma vez só por mesa
    # (a busca já impede a mesma chave para dois jogadores)
    return items


def run_pool_draw(
    players: list, filters: dict, rng: random.Random | None = None, seats: list[Seat] | None = None
) -> tuple[list[Candidate], int]:
    rng = rng or random.SystemRandom()
    seats = seats or [Seat(name=p.username, user=p) for p in players]
    items = pool_items(players, filters.get("max_bracket"))

    owners = {i.owner.pk for i in items}
    if len(owners) < 2:
        raise DrawError("Pelo menos dois jogadores precisam ter decks na deckpool.")

    chosen = assign(seats, items, filters.get("color_rule", COLORS_ANY), rng, bool(filters.get("bracket_balance")))
    if not chosen:
        no_decks = [p.username for p in players if p.pk not in owners]
        hint = f" ({', '.join(no_decks)} sem decks na pool)" if no_decks else ""
        base = _no_combo_message(seats, filters)
        if base == "Não há decks suficientes para essa mesa.":
            base = "Não dá para montar a mesa: faltam decks de outros jogadores para cada pessoa" + hint + "."
        raise DrawError(base)
    return chosen, len(items)


@transaction.atomic
def create_pool_draw(creator, players: list, filters: dict, rng: random.Random | None = None, room=None) -> Draw:
    seats = [Seat(name=p.username, user=p) for p in players]
    apply_history(seats, filters, creator=creator, room=room)
    items, pool_size = run_pool_draw(players, filters, rng, seats=seats)
    draw = Draw.objects.create(
        code=_new_code(), mode=Draw.Mode.POOL, created_by=creator, filters=filters, pool_size=pool_size, room=room
    )
    DrawEntry.objects.bulk_create(
        DrawEntry(
            draw=draw, position=i, player_name=seat.name, player=seat.user,
            deck=item.deck, user_deck=item.user_deck, owner=item.owner,
        )
        for i, (seat, item) in enumerate(zip(seats, items))
    )
    return draw
