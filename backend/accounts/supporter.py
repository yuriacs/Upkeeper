"""
Apoiadores: quem doa por Pix paga com os centavos reservados para a conta e clica em "Já doei"
(o aviso entra na fila do admin); no Ko-fi, escreve o nome de usuário na mensagem. O admin ativa no
painel com um clique. Cada ativação vale DAYS dias, somados ao que ainda faltava, e pode ser presente
para outra conta.

Os perks são só enfeites, nada de Magic fica pago (Fan Content Policy da Wizards):
- selo e nome dourado (perfil, ranking e mesa virtual);
- cor do sleeve (verso das cartas viradas para baixo na mesa);
- fundo do próprio campo na mesa (imagem enviada, moderada como a foto de perfil);
- mural de apoiadores na página de apoio (só quem escolher aparecer);
- Fundador: selo permanente (não vence) e o nome na página de créditos, para quem apoiar até
  FOUNDER_UNTIL ou somar FOUNDER_TOTAL_CENTS em doações a qualquer momento. Com o apoio ativo, o
  Fundador também tem sleeve com imagem própria (moderada), sleeve foil, moldura animada no avatar
  e um título de uma lista fixa (TITLES) abaixo do nome. Venceu o apoio, esses somem; o selo fica.

Do pagamento, o servidor guarda só o total somado (que o admin digita ao ativar), para o Fundador:
nada de cada doação, nome no banco ou e-mail. Venceu, os enfeites somem sozinhos; as escolhas
(sleeve, fundo, mural) ficam para quando renovar.
"""

import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

DAYS = 30
# Cores de sleeve (o frontend desenha cada uma): a primeira é a padrão do site
SLEEVES = ("ember", "azure", "emerald", "crimson", "violet", "gold", "silver", "obsidian")
# Títulos de Fundador (o frontend traduz cada um): lista fixa, sem texto livre
TITLES = (
    "token_master", "mulligan_legend", "table_politician", "public_enemy", "combo_master", "group_hug",
    "pillow_fort", "topdeck_luck", "kingmaker", "precon_hero", "salt_mine", "agent_of_chaos",
)
PLAYMAT_SIZE = (1280, 720)
WALL_CACHE = "supporters:wall"
CREDITS_CACHE = "supporters:credits"
# Fundador: qualquer doação até o fim do dia FOUNDER_UNTIL (horário de Brasília) ou R$ 100 somados
FOUNDER_UNTIL = datetime(2026, 12, 31, 23, 59, 59, tzinfo=ZoneInfo("America/Sao_Paulo"))
FOUNDER_TOTAL_CENTS = 10_000
MAX_AMOUNT_CENTS = 10_000_000  # R$ 100 mil numa doação: acima disso é erro de digitação


def _active(row) -> bool:
    return row is not None and row.until > timezone.now()


def row_of(user):
    from .models import Supporter

    return Supporter.objects.filter(user=user).first()


def is_active(user) -> bool:
    return _active(row_of(user))


def _founder_perks(row) -> bool:
    """Enfeites de Fundador: Fundador com o apoio de 30 dias ativo."""
    return _active(row) and row.founder_at is not None


def has_founder_perks(user) -> bool:
    return _founder_perks(row_of(user))


def active_ids(user_ids) -> set[int]:
    """Quais destas contas são apoiadoras agora (uma consulta só, para listas)."""
    from .models import Supporter

    ids = [i for i in user_ids if i]
    if not ids:
        return set()
    return set(Supporter.objects.filter(user_id__in=ids, until__gt=timezone.now()).values_list("user_id", flat=True))


def founder_ids(user_ids) -> set[int]:
    """Quais destas contas são Fundadoras (uma consulta só, para listas)."""
    from .models import Supporter

    ids = [i for i in user_ids if i]
    if not ids:
        return set()
    return set(Supporter.objects.filter(user_id__in=ids, founder_at__isnull=False).values_list("user_id", flat=True))


def is_founder(user) -> bool:
    row = row_of(user)
    return row is not None and row.founder_at is not None


def _forget(user) -> None:
    cache.delete(f"profile:{user.pk}")
    cache.delete(WALL_CACHE)
    cache.delete(CREDITS_CACHE)


def _donated(row, amount_cents: int, now) -> None:
    """Soma a doação ao total e, se for o caso, torna a conta Fundadora (para sempre)."""
    row.total_cents += amount_cents
    if row.founder_at is None and (now <= FOUNDER_UNTIL or row.total_cents >= FOUNDER_TOTAL_CENTS):
        row.founder_at = now


def grant(user, days: int = DAYS, amount_cents: int = 0):
    """
    Ativa ou renova: soma `days` dias ao que faltava (ou a partir de agora, se já venceu) e
    `amount_cents` ao total doado. Num presente, quem pagou recebe o valor por `credit`.
    """
    from .models import Supporter

    now = timezone.now()
    row, _ = Supporter.objects.get_or_create(user=user, defaults={"until": now})
    row.until = max(row.until, now) + timedelta(days=days)
    row.times += 1
    _donated(row, amount_cents, now)
    row.save(update_fields=["until", "times", "total_cents", "founder_at"])
    _forget(user)
    return row


def credit(user, amount_cents: int = 0):
    """Quem pagou um presente: o valor entra no total dele (e conta para Fundador), sem ativar dias."""
    from .models import Supporter

    now = timezone.now()
    row, _ = Supporter.objects.get_or_create(user=user, defaults={"until": now})
    _donated(row, amount_cents, now)
    row.save(update_fields=["total_cents", "founder_at"])
    _forget(user)
    return row


def revoke(user) -> None:
    """Encerra o apoio agora (as escolhas ficam guardadas)."""
    from .models import Supporter

    Supporter.objects.filter(user=user).update(until=timezone.now())
    _forget(user)


# ---- avisos de doação (Pix) ---------------------------------------------------------------------
# O extrato de quem recebe sempre mostra o valor exato, mas quase nunca a descrição de um Pix
# estático. Por isso cada conta logada recebe centavos só dela (R$ 10,37) por RESERVE_HOURS; depois
# de pagar, clica em "Já doei" e o aviso entra na fila do admin, que confere o extrato e ativa.
# O aviso some ao ativar, ao recusar ou depois de CLAIM_DAYS: nada do pagamento fica guardado.

RESERVE_HOURS = 48
CLAIM_DAYS = 7


def _alive_claims(now=None):
    from django.db.models import Q

    from .models import DonationClaim

    now = now or timezone.now()
    return DonationClaim.objects.filter(
        Q(claimed_at__isnull=True, created_at__gt=now - timedelta(hours=RESERVE_HOURS))
        | Q(claimed_at__gt=now - timedelta(days=CLAIM_DAYS))
    )


def purge_claims() -> None:
    """Apaga reservas e avisos vencidos."""
    from .models import DonationClaim

    DonationClaim.objects.exclude(pk__in=_alive_claims().values("pk")).delete()


def reserve(user):
    """Centavos desta conta: os que ainda valem, ou novos (de 1 a 99, sem repetir os de outras contas)."""
    import random

    from .models import DonationClaim

    row = _alive_claims().filter(user=user).first()
    if row:
        return row
    purge_claims()
    taken = set(DonationClaim.objects.values_list("cents", flat=True))
    free = [c for c in range(1, 100) if c not in taken]
    # Com as 99 ocupadas, repete: o admin ainda separa pelo horário do aviso
    cents = random.choice(free) if free else random.randint(1, 99)
    row, _ = DonationClaim.objects.update_or_create(
        user=user, defaults={"cents": cents, "created_at": timezone.now(), "claimed_at": None, "gift_to": None}
    )
    return row


def claim(user, gift_to=None):
    """'Já doei': o aviso entra na fila do admin (de novo só troca o presenteado)."""
    row = reserve(user)
    row.gift_to = gift_to if gift_to is not None and gift_to.pk != user.pk else None
    row.claimed_at = row.claimed_at or timezone.now()
    row.save(update_fields=["gift_to", "claimed_at"])
    return row


def claim_info(row) -> dict:
    return {
        "cents": row.cents,
        "reserved_until": (row.created_at + timedelta(hours=RESERVE_HOURS)).isoformat(),
        "claimed_at": row.claimed_at.isoformat() if row.claimed_at else None,
        "gift": row.gift_to.username if row.gift_to_id else None,
    }


def pending_claims():
    """Fila do admin: quem avisou que doou, do aviso mais antigo para o mais novo."""
    return (
        _alive_claims().filter(claimed_at__isnull=False).select_related("user", "gift_to").order_by("claimed_at")
    )


def resolve_claim(row, accept: bool, amount_cents: int = 0):
    """
    Ativa os 30 dias (para quem pagou ou para o presenteado) ou recusa; o aviso some nos dois casos.
    O valor vai para o total de quem pagou, mesmo quando é presente.
    """
    granted = None
    if accept and row.gift_to_id:
        granted = grant(row.gift_to)
        credit(row.user, amount_cents)
    elif accept:
        granted = grant(row.user, amount_cents=amount_cents)
    row.delete()
    return granted


# ---- fundo da mesa ------------------------------------------------------------------------------

# Imagens dos apoiadores (fundo do campo e sleeve) em memória, por "tipo:chave"
_CACHE: dict[str, tuple[float, bytes]] = {}
_CACHE_MAX = 100
CACHE_SECONDS = 600  # curto: uma imagem escondida pelo admin para de sair também nos outros workers


def _cached(model, key) -> bytes | None:
    k = f"{model.__name__}:{key}"
    hit = _CACHE.get(k)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    row = model.objects.filter(key=key, hidden_at__isnull=True).only("image").first()
    if row is None:
        _CACHE.pop(k, None)
        return None
    data = bytes(row.image)
    if k not in _CACHE and len(_CACHE) >= _CACHE_MAX:
        _CACHE.pop(next(iter(_CACHE)))
    _CACHE[k] = (time.monotonic(), data)
    return data


def playmat_url_for(key) -> str:
    return f"{settings.PUBLIC_API_BASE}/api/playmat/{key}/"


def playmat_url(user) -> str | None:
    """Endereço do fundo da mesa (None sem fundo ou escondido)."""
    from .models import Playmat

    key = Playmat.objects.filter(user=user, hidden_at__isnull=True).values_list("key", flat=True).first()
    return playmat_url_for(key) if key else None


def forget_playmat(key) -> None:
    _CACHE.pop(f"Playmat:{key}", None)


def cached_playmat(key) -> bytes | None:
    from .models import Playmat

    return _cached(Playmat, key)


# ---- sleeve com imagem (Fundador) -----------------------------------------------------------------


def sleeve_url_for(key) -> str:
    return f"{settings.PUBLIC_API_BASE}/api/sleeve/{key}/"


def sleeve_url(user) -> str | None:
    """Endereço do sleeve com imagem (None sem imagem ou escondida)."""
    from .models import SleeveArt

    key = SleeveArt.objects.filter(user=user, hidden_at__isnull=True).values_list("key", flat=True).first()
    return sleeve_url_for(key) if key else None


def forget_sleeve(key) -> None:
    _CACHE.pop(f"SleeveArt:{key}", None)


def cached_sleeve(key) -> bytes | None:
    from .models import SleeveArt

    return _cached(SleeveArt, key)


# ---- o que cada lugar do site recebe -------------------------------------------------------------


def cosmetics(user) -> dict:
    """Enfeites que os outros veem (mesa virtual). Vazio se não for apoiador agora."""
    row = row_of(user)
    if not _active(row):
        return {"supporter": False, "sleeve": "", "playmat": "", "sleeve_image": "", "foil": False, "frame": False}
    perks = _founder_perks(row)
    return {
        "supporter": True,
        "sleeve": row.sleeve,
        "playmat": playmat_url(user) or "",
        "sleeve_image": (sleeve_url(user) or "") if perks else "",
        "foil": perks and row.foil,
        "frame": perks and row.frame,
    }


def public(user) -> dict:
    """Perfil público: selos e, para Fundador com apoio ativo, o título e a moldura."""
    row = row_of(user)
    perks = _founder_perks(row)
    return {
        "supporter": _active(row),
        "founder": row is not None and row.founder_at is not None,
        "title": row.title if perks else "",
        "frame": perks and row.frame,
    }


def info(user) -> dict:
    """Para o próprio jogador (/api/auth/me/): situação e escolhas."""
    row = row_of(user)
    return {
        "active": _active(row),
        "until": row.until.isoformat() if row else None,
        "ever": row is not None and (row.times > 0 or row.total_cents > 0 or row.founder_at is not None),
        "sleeve": row.sleeve if row else "",
        "on_wall": row.on_wall if row else False,
        "playmat": playmat_url(user),
        "days": DAYS,
        "total_cents": row.total_cents if row else 0,
        "founder": row is not None and row.founder_at is not None,
        "in_credits": row.in_credits if row else True,
        "founder_until": FOUNDER_UNTIL.isoformat(),
        "founder_total_cents": FOUNDER_TOTAL_CENTS,
        "founder_perks": _founder_perks(row),
        "sleeve_image": sleeve_url(user),
        "foil": row.foil if row else False,
        "frame": row.frame if row else True,
        "title": row.title if row else "",
    }


def wall() -> list[dict]:
    """Mural: apoiadores ativos que escolheram aparecer, do mais antigo para o mais novo."""
    from .avatar import url_for
    from .models import Avatar, Supporter

    data = cache.get(WALL_CACHE)
    if data is not None:
        return data
    rows = list(
        Supporter.objects.filter(on_wall=True, until__gt=timezone.now(), user__is_active=True)
        .select_related("user")
        .order_by("since")[:300]
    )
    avatars = dict(
        Avatar.objects.filter(user_id__in=[r.user_id for r in rows], hidden_at__isnull=True).values_list(
            "user_id", "key"
        )
    )
    data = [
        {"username": r.user.username, "avatar": url_for(avatars[r.user_id]) if r.user_id in avatars else None}
        for r in rows
    ]
    cache.set(WALL_CACHE, data, 300)
    return data


def credits() -> list[dict]:
    """Página de créditos: todos os Fundadores (menos quem pediu para sair), do primeiro ao mais novo."""
    from .avatar import url_for
    from .models import Avatar, Supporter

    data = cache.get(CREDITS_CACHE)
    if data is not None:
        return data
    rows = list(
        Supporter.objects.filter(founder_at__isnull=False, in_credits=True, user__is_active=True)
        .select_related("user")
        .order_by("founder_at")[:1000]
    )
    avatars = dict(
        Avatar.objects.filter(user_id__in=[r.user_id for r in rows], hidden_at__isnull=True).values_list(
            "user_id", "key"
        )
    )
    data = [
        {"username": r.user.username, "avatar": url_for(avatars[r.user_id]) if r.user_id in avatars else None}
        for r in rows
    ]
    cache.set(CREDITS_CACHE, data, 300)
    return data
