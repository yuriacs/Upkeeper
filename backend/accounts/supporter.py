"""
Apoiadores: quem doa por Pix paga com os centavos reservados para a conta e clica em "Já doei"
(o aviso entra na fila do admin); no Ko-fi, escreve o nome de usuário na mensagem. O admin ativa no
painel com um clique. Cada ativação vale DAYS dias, somados ao que ainda faltava, e pode ser presente
para outra conta.

Os perks são só enfeites, nada de Magic fica pago (Fan Content Policy da Wizards):
- selo e nome dourado (perfil, ranking e mesa virtual);
- cor do sleeve (verso das cartas viradas para baixo na mesa);
- fundo do próprio campo na mesa (imagem enviada, moderada como a foto de perfil);
- mural de apoiadores na página de apoio (só quem escolher aparecer).

O servidor não guarda nada do pagamento (valor, nome no banco, e-mail): só até quando vale.
Venceu, os enfeites somem sozinhos; as escolhas (sleeve, fundo, mural) ficam para quando renovar.
"""

import time
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

DAYS = 30
# Cores de sleeve (o frontend desenha cada uma): a primeira é a padrão do site
SLEEVES = ("ember", "azure", "emerald", "crimson", "violet", "gold", "silver", "obsidian")
PLAYMAT_SIZE = (1280, 720)
WALL_CACHE = "supporters:wall"


def _active(row) -> bool:
    return row is not None and row.until > timezone.now()


def row_of(user):
    from .models import Supporter

    return Supporter.objects.filter(user=user).first()


def is_active(user) -> bool:
    return _active(row_of(user))


def active_ids(user_ids) -> set[int]:
    """Quais destas contas são apoiadoras agora (uma consulta só, para listas)."""
    from .models import Supporter

    ids = [i for i in user_ids if i]
    if not ids:
        return set()
    return set(Supporter.objects.filter(user_id__in=ids, until__gt=timezone.now()).values_list("user_id", flat=True))


def _forget(user) -> None:
    cache.delete(f"profile:{user.pk}")
    cache.delete(WALL_CACHE)


def grant(user, days: int = DAYS):
    """Ativa ou renova: soma `days` dias ao que faltava (ou a partir de agora, se já venceu)."""
    from .models import Supporter

    now = timezone.now()
    row, _ = Supporter.objects.get_or_create(user=user, defaults={"until": now})
    row.until = max(row.until, now) + timedelta(days=days)
    row.times += 1
    row.save(update_fields=["until", "times"])
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


def resolve_claim(row, accept: bool):
    """Ativa os 30 dias (para quem pagou ou para o presenteado) ou recusa; o aviso some nos dois casos."""
    target = row.gift_to or row.user
    granted = grant(target) if accept else None
    row.delete()
    return granted


# ---- fundo da mesa ------------------------------------------------------------------------------

_CACHE: dict[str, tuple[float, bytes]] = {}
_CACHE_MAX = 100
CACHE_SECONDS = 600  # curto: um fundo escondido pelo admin para de sair também nos outros workers


def playmat_url_for(key) -> str:
    return f"{settings.PUBLIC_API_BASE}/api/playmat/{key}/"


def playmat_url(user) -> str | None:
    """Endereço do fundo da mesa (None sem fundo ou escondido)."""
    from .models import Playmat

    key = Playmat.objects.filter(user=user, hidden_at__isnull=True).values_list("key", flat=True).first()
    return playmat_url_for(key) if key else None


def forget_playmat(key) -> None:
    _CACHE.pop(str(key), None)


def cached_playmat(key) -> bytes | None:
    from .models import Playmat

    k = str(key)
    hit = _CACHE.get(k)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    row = Playmat.objects.filter(key=key, hidden_at__isnull=True).only("image").first()
    if row is None:
        _CACHE.pop(k, None)
        return None
    data = bytes(row.image)
    if k not in _CACHE and len(_CACHE) >= _CACHE_MAX:
        _CACHE.pop(next(iter(_CACHE)))
    _CACHE[k] = (time.monotonic(), data)
    return data


# ---- o que cada lugar do site recebe -------------------------------------------------------------


def cosmetics(user) -> dict:
    """Enfeites que os outros veem (mesa virtual). Vazio se não for apoiador agora."""
    row = row_of(user)
    if not _active(row):
        return {"supporter": False, "sleeve": "", "playmat": ""}
    return {"supporter": True, "sleeve": row.sleeve, "playmat": playmat_url(user) or ""}


def info(user) -> dict:
    """Para o próprio jogador (/api/auth/me/): situação e escolhas."""
    row = row_of(user)
    return {
        "active": _active(row),
        "until": row.until.isoformat() if row else None,
        "ever": row is not None and row.times > 0,
        "sleeve": row.sleeve if row else "",
        "on_wall": row.on_wall if row else False,
        "playmat": playmat_url(user),
        "days": DAYS,
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
