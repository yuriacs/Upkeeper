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
from django.utils.translation import gettext as _

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
    power: float | None = None  # nível de poder estimado (1 a 10)


POWER_SPREAD = 1.5  # mesa equilibrada: diferença máxima de nível de poder entre os decks


def _balanced(item: Candidate, chosen: list[Candidate]) -> bool:
    """
    Mesa equilibrada: no máximo 1 bracket e 1,5 ponto de nível de poder de diferença entre os
    decks. Decks ainda sem bracket/nível não restringem.
    """
    for attr, spread in (("bracket", 1), ("power", POWER_SPREAD)):
        value = getattr(item, attr)
        if value is None:
            continue
        known = [getattr(c, attr) for c in chosen if getattr(c, attr) is not None] + [value]
        if max(known) - min(known) > spread:
            return False
    return True


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
            if balance and not _balanced(item, chosen):
                continue
            if _colors_ok(item.color_identity, colors, rule):
                found = search(pos + 1, chosen + [item])
                if found:
                    return found
        return None

    return search(0, [])


def NOT_ENOUGH() -> str:  # noqa: N802
    return _("Not enough decks for this table.")


def _no_combo_message(seats: list[Seat], filters: dict) -> str:
    reasons = []
    if filters.get("color_rule", COLORS_ANY) != COLORS_ANY:
        reasons.append(_("the color rule"))
    if filters.get("no_repeat") and any(s.excluded for s in seats):
        reasons.append(_('"No repeats"'))
    if filters.get("same_edition"):
        reasons.append(_('"Same set"'))
    if filters.get("bracket_balance"):
        reasons.append(_('"Balanced table"'))
    if not reasons:
        return NOT_ENOUGH()
    return _("Not enough decks for this table with {reasons}. Try loosening the rules.").format(
        reasons=_(" and ").join(reasons)
    )


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


RANDOM_TRIES = 12  # precons conferidos (bracket, valor e tutores) antes de desistir


def random_precon(
    *,
    max_bracket: int | None = None,
    max_price: float | None = None,
    max_tutors: int | None = None,
    colors: str = "",
    exclude=(),
    rng: random.Random | None = None,
) -> tuple[Deck, int] | None:
    """
    Um precon ao acaso para a mesa virtual ("Sortear" na escolha do deck), dentro das regras da
    mesa e com as cores pedidas (o deck tem pelo menos essas cores). `exclude`: slugs que não
    servem (os decks que já estão na mesa, o que acabou de sair). Devolve (deck, quantos serviam
    pelo que o banco já sabe), ou None se nenhum serve. Os que ainda não têm bracket ou valor ficam
    por último (calcular é mais lento) e os tutores são contados só nos escolhidos.
    """
    from .analysis import deck_tutors
    from .brackets import ensure_bracket
    from .prices import update_deck_price

    rng = rng or random.SystemRandom()
    excluded = set(exclude)
    want = set(colors)
    decks = [
        d for d in eligible_decks({"max_bracket": max_bracket})
        if d.slug not in excluded and want <= set(d.color_identity)
        and (max_price is None or d.price_usd is None or float(d.price_usd) <= max_price)
    ]  # fmt: skip
    if not decks:
        return None
    rng.shuffle(decks)
    unknown = lambda d: (max_bracket is not None and d.bracket is None) or (max_price is not None and d.price_usd is None)  # noqa: E731
    decks.sort(key=unknown)
    for deck in decks[:RANDOM_TRIES]:
        if max_bracket is not None and deck.bracket is None:
            ensure_bracket(deck)
            if deck.bracket is not None and deck.bracket > max_bracket:
                continue
        if max_price is not None and deck.price_usd is None:
            update_deck_price(deck, refresh=False)
            if deck.price_usd is not None and float(deck.price_usd) > max_price:
                continue
        if max_tutors is not None and deck_tutors(deck) > max_tutors:
            continue
        return deck, len(decks)
    return None


def run_draw(seats: int | list[Seat], filters: dict, rng: random.Random | None = None) -> tuple[list[Deck], int]:
    rng = rng or random.SystemRandom()
    if isinstance(seats, int):
        seats = [Seat(name=_("Player {n}").format(n=i + 1)) for i in range(seats)]
    players = len(seats)
    decks = eligible_decks(filters)
    rule = filters.get("color_rule", COLORS_ANY)
    balance = bool(filters.get("bracket_balance"))

    if len(decks) < players:
        raise DrawError(
            _("Only {found} deck(s) match the filters; {needed} are needed.").format(found=len(decks), needed=players)
        )

    def candidates(group):
        return [
            Candidate(
                key=("precon", d.pk), color_identity=d.color_identity, deck=d, bracket=d.bracket, power=d.power
            )
            for d in group
        ]

    if filters.get("same_edition"):
        groups: dict[int, list[Deck]] = defaultdict(list)
        for d in decks:
            groups[d.edition_id].append(d)
        options = [g for g in groups.values() if len(g) >= players]
        if not options:
            raise DrawError(_("No set has {n} decks that match the filters.").format(n=players))
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


# --- Resortear o deck de um jogador (uma vez por sorteio) -----------------------------------

def _entry_candidate(entry: DrawEntry) -> Candidate | None:
    if entry.deck_id:
        d = entry.deck
        return Candidate(key=("precon", d.pk), color_identity=d.color_identity, deck=d, bracket=d.bracket, power=d.power)
    if entry.user_deck_id:
        u = entry.user_deck
        return Candidate(
            key=("user", u.pk), color_identity=u.color_identity, user_deck=u, owner=u.owner, bracket=u.bracket,
            power=u.power,
        )
    return None


@transaction.atomic
def reroll_entry(draw: Draw, position: int, rng: random.Random | None = None) -> DrawEntry:
    """
    Troca só o deck de um jogador, uma vez por sorteio, mantendo os decks dos outros e as mesmas
    regras (filtros, cores, mesa equilibrada, mesma coleção, não repetir, não receber o próprio deck).
    """
    rng = rng or random.SystemRandom()
    draw = Draw.objects.select_for_update().get(pk=draw.pk)
    entries = list(draw.entries.select_related("deck", "user_deck__owner", "owner", "player"))
    entry = next((e for e in entries if e.position == position), None)
    if entry is None:
        raise DrawError(_("Player not found in this deal."))
    if entry.rerolled_from:
        raise DrawError(_("You already re-dealt your deck in this deal."))
    if draw.winner_position is not None:
        raise DrawError(_("This game already has a result."))
    filters = draw.filters or {}
    chosen = [c for c in (_entry_candidate(e) for e in entries if e is not entry) if c]
    current = _entry_candidate(entry)

    if draw.mode == Draw.Mode.POOL:
        pool = pool_items([e.player for e in entries if e.player], filters.get("max_bracket"))
    else:
        decks = eligible_decks(filters)
        if filters.get("same_edition"):
            editions = {c.deck.edition_id for c in chosen if c.deck}
            if editions:
                decks = [d for d in decks if d.edition_id in editions]
        pool = [
            Candidate(key=("precon", d.pk), color_identity=d.color_identity, deck=d, bracket=d.bracket, power=d.power)
            for d in decks
        ]

    seat = Seat(name=entry.player_name, user=entry.player)
    apply_history([seat], filters, creator=draw.created_by, room=draw.room)
    if current:
        seat.excluded.add(current.key)
    used = {c.key for c in chosen}
    colors = [c.color_identity for c in chosen]
    rule = filters.get("color_rule", COLORS_ANY)
    balance = bool(filters.get("bracket_balance"))
    options = [
        item
        for item in pool
        if item.key not in used
        and item.key not in seat.excluded
        and not (seat.user is not None and item.owner is not None and item.owner.pk == seat.user.pk)
        and _colors_ok(item.color_identity, colors, rule)
        and (not balance or _balanced(item, chosen))
    ]
    if not options:
        raise DrawError(_("No other deck fits this table's rules."))
    pick = rng.choice(options)
    old = entry.deck or entry.user_deck
    entry.rerolled_from = (old.name if old else "?")[:200]
    entry.deck, entry.user_deck, entry.owner = pick.deck, pick.user_deck, pick.owner
    entry.save(update_fields=["rerolled_from", "deck", "user_deck", "owner"])
    return entry


# --- Modo deckpool: decks dos próprios jogadores; ninguém recebe um deck que é seu ---------

# Mantido para quem já usa o nome antigo (testes, shell)
PoolItem = Candidate


def pool_items(players: list, max_bracket: int | None = None) -> list[Candidate]:
    from pools.models import OwnedPrecon, UserDeck

    items = [
        Candidate(
            key=("precon", op.deck.pk), owner=op.user, color_identity=op.deck.color_identity, deck=op.deck,
            bracket=op.deck.bracket, power=op.deck.power,
        )
        for op in OwnedPrecon.objects.filter(user__in=players).select_related("user", "deck")
    ]
    items += [
        Candidate(
            key=("user", ud.pk), owner=ud.owner, color_identity=ud.color_identity, user_deck=ud, bracket=ud.bracket,
            power=ud.power,
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
        raise DrawError(_("At least two players need decks in their deck pool."))

    chosen = assign(seats, items, filters.get("color_rule", COLORS_ANY), rng, bool(filters.get("bracket_balance")))
    if not chosen:
        no_decks = [p.username for p in players if p.pk not in owners]
        hint = " " + _("({names} with no decks in the pool)").format(names=", ".join(no_decks)) if no_decks else ""
        base = _no_combo_message(seats, filters)
        if base == NOT_ENOUGH():
            base = _("Can't build the table: not enough decks from other players for everyone") + hint + "."
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
