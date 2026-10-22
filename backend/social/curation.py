"""
Curadoria do Instagram: acha o post que furou a bolha nos perfis monitorados e prepara o repost.

1. collect(): coleta pelo Apify os perfis ativos (Creator) e grava os posts (SourcePost; o
   shortcode é único, então nada entra duas vezes).
2. Ranking: engajamento = (curtidas + comentários) / seguidores, só da janela de
   SOCIAL_WINDOW_HOURS. "Furou a bolha" = engajamento pelo menos SOCIAL_MIN_OUTLIER vezes a
   mediana dos posts recentes do próprio perfil (assim perfil pequeno concorre com grande).
3. curate(): o editor (Gemini) recusa propaganda e tom fora da linha; o aprovado vira repost se o
   autor autorizou, ou um pedido de autorização (mensagem pronta para a DM) se ainda não.
4. enqueue(): legenda + "Créditos/Via: @autor", mídia no Cloudinary e um SocialPost "repost" na
   fila do painel (rascunho, ou já aprovado com SOCIAL_AUTO_APPROVE).
5. publish_next(): publica o repost aprovado mais antigo pela API oficial do Instagram.
"""

import logging
import re
from datetime import datetime, timedelta
from statistics import median

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from . import clients
from .drafts import TAGS
from .models import Creator, SocialPost, SourcePost

log = logging.getLogger(__name__)

CAPTION_LIMIT = 2200  # limite do Instagram
ASK_EXPIRES_DAYS = 7  # pedido sem resposta: o momento do post já passou
MAX_ASKS = 2  # pedidos de autorização por rodada
MAX_TRIES = 5  # candidatos avaliados pelo editor por rodada
TYPES = {"Image": "image", "Video": "video", "Sidecar": "carousel"}

EDITOR = {
    "pt": """Você é o editor-chefe do perfil do Upkeeper no Instagram (upkeeper.online), uma mesa virtual
gratuita para jogar Magic: The Gathering no formato Commander (EDH). O perfil faz curadoria de
posts de outros criadores do nicho, sempre com autorização e crédito.

Aprove (approved=true) só posts sobre Magic/Commander com valor para quem joga: jogadas, combos,
decks, cartas, humor do jogo, histórias de mesa, novidades. Recuse (approved=false) propaganda ou
publi óbvia (sorteio, cupom, "link na bio" para comprar), venda de cartas, polêmica, ataque a
pessoas, conteúdo adulto ou fora do nicho. Explique em "reason" numa frase.

Se aprovar, escreva em "caption" uma legenda original em português do Brasil (não copie a
original):
- As 2 primeiras linhas são um gancho forte (aparecem antes do "ver mais").
- Depois, 2 a 4 linhas resumindo o que importa, com contexto para quem joga Commander.
- Feche com uma pergunta ou chamada que puxe comentários.
- Sem hashtags, sem @ de ninguém e sem linha de créditos (o sistema acrescenta).
- No máximo 1200 caracteres. Emojis com moderação.""",
    "en": """You are the editor-in-chief of Upkeeper's Instagram (upkeeper.online), a free virtual table to
play Magic: The Gathering Commander (EDH). The account curates posts from other creators in the
niche, always with permission and credit.

Approve (approved=true) only posts about Magic/Commander that give players value: plays, combos,
decks, cards, game humor, table stories, news. Reject (approved=false) obvious ads or sponsored
posts (giveaways, coupons, "link in bio" to buy), card sales, drama, attacks on people, adult or
off-topic content. Explain in "reason" in one sentence.

If approved, write in "caption" an original English caption (don't copy the original):
- The first 2 lines are a strong hook (shown before "more").
- Then 2 to 4 lines summing up what matters, with context for Commander players.
- End with a question or call to action that invites comments.
- No hashtags, no @ mentions and no credits line (the system adds it).
- At most 1200 characters. Emojis in moderation.""",
}

ASK = {
    "pt": ("Oi, @{handle}! Aqui é do Upkeeper (upkeeper.online), uma mesa virtual gratuita de Commander. "
           "Curtimos muito este seu post: {url}\n\nPodemos repostá-lo no nosso perfil? A legenda leva o "
           "crédito com o seu @ logo no começo do texto. Se preferir que não, sem problema nenhum, e se "
           "quiser liberar seus posts em geral é só avisar."),
    "en": ("Hi @{handle}! This is Upkeeper (upkeeper.online), a free virtual table for Commander. "
           "We really liked this post of yours: {url}\n\nCould we repost it on our profile? The caption "
           "credits you with your @. If you'd rather not, no problem at all, and if you're fine with us "
           "reposting your posts in general, just let us know."),
}  # fmt: skip


def credit_line(handle: str) -> str:
    return f"Créditos/Via: @{handle}"


def _lang():
    return "en" if settings.SOCIAL_LANG == "en" else "pt"


def _when(value) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _media(item: dict, kind: str) -> str:
    return (item.get("videoUrl") if kind == "video" else item.get("displayUrl")) or ""


def collect() -> int:
    """Coleta os perfis ativos e grava/atualiza os posts. Devolve quantos posts vieram."""
    creators = {c.handle.lower(): c for c in Creator.objects.filter(active=True)}
    if not creators:
        return 0
    total = 0
    for profile in clients.scrape_profiles(list(creators)):
        creator = creators.get(str(profile.get("username", "")).lower())
        if creator is None:
            continue
        creator.followers = max(int(profile.get("followersCount") or 0), 0)
        creator.save(update_fields=["followers"])
        for item in profile.get("latestPosts") or []:
            posted_at = _when(item.get("timestamp"))
            code = item.get("shortCode")
            if not code or posted_at is None:
                continue
            kind = TYPES.get(item.get("type"), "image")
            # Curtidas ocultas vêm como -1
            likes, comments = max(int(item.get("likesCount") or 0), 0), max(int(item.get("commentsCount") or 0), 0)
            SourcePost.objects.update_or_create(
                shortcode=code,
                defaults={"likes": likes, "comments": comments, "media_url": _media(item, kind)},
                create_defaults={
                    "creator": creator, "url": item.get("url") or f"https://www.instagram.com/p/{code}/",
                    "media_type": kind, "media_url": _media(item, kind), "caption": item.get("caption") or "",
                    "likes": likes, "comments": comments, "posted_at": posted_at,
                },
            )  # fmt: skip
            total += 1
        rank(creator)
    return total


def rank(creator: Creator):
    """Engajamento de cada post do perfil e quantas vezes isso é a mediana dos posts recentes."""
    posts = list(creator.posts.order_by("-posted_at")[:30])
    followers = max(creator.followers, 1)
    for p in posts:
        p.engagement = (p.likes + p.comments) / followers
    typical = median(p.engagement for p in posts) if posts else 0
    for p in posts:
        p.outlier = p.engagement / typical if typical else 0
    SourcePost.objects.bulk_update(posts, ["engagement", "outlier"])


def candidates():
    """Posts da janela que furaram a bolha, do mais atípico ao menos."""
    since = timezone.now() - timedelta(hours=settings.SOCIAL_WINDOW_HOURS)
    return (
        SourcePost.objects.filter(status=SourcePost.Status.NEW, posted_at__gte=since, creator__active=True,
                                  outlier__gte=settings.SOCIAL_MIN_OUTLIER, engagement__gt=0)
        .exclude(media_url="")
        .select_related("creator")
        .order_by("-outlier", "-engagement")
    )  # fmt: skip


def edit(sp: SourcePost) -> dict:
    """Parecer do editor (Gemini): {approved, reason, caption}."""
    prompt = (f"Autor: @{sp.creator.handle}\nTipo: {sp.media_type}\nCurtidas: {sp.likes}\n"
              f"Comentários: {sp.comments}\n\nLegenda original:\n{sp.caption[:3000] or '(sem legenda)'}")
    return clients.gemini_json(EDITOR[_lang()], prompt, clients.EDITOR_SCHEMA)


def caption_for(text: str, handle: str) -> str:
    """Legenda final: texto do editor, a linha de créditos e as hashtags, dentro do limite."""
    # O editor não deve pôr créditos nem @; se puser, sai (a linha oficial é a nossa)
    lines = [ln for ln in text.strip().splitlines() if not re.match(r"\s*(cr[ée]ditos|credits|via)\b", ln, re.I)]
    body = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    tail = f"\n\n{credit_line(handle)}\n\n{TAGS['instagram']}"
    if len(body) + len(tail) > CAPTION_LIMIT:
        body = body[: CAPTION_LIMIT - len(tail) - 1].rstrip() + "…"
    return body + tail


def enqueue(sp: SourcePost, caption: str | None = None) -> SocialPost:
    """Sobe a mídia e põe o repost na fila. Sem `caption`, pede uma ao editor (sem poder recusar)."""
    if sp.media_type not in ("image", "video"):
        raise clients.ServiceError("carrossel ainda não é publicado pela curadoria")
    caption = caption or edit(sp).get("caption") or ""
    if not caption.strip():
        raise clients.ServiceError("o editor não escreveu legenda")
    media_url = clients.host_media(sp.media_url, sp.media_type, sp.shortcode)
    authorized = sp.creator.authorized or sp.permission_granted_at
    post = SocialPost.objects.create(
        network=SocialPost.Network.INSTAGRAM, kind="repost", lang=_lang(), source=sp,
        status=SocialPost.Status.APPROVED if settings.SOCIAL_AUTO_APPROVE and authorized else SocialPost.Status.DRAFT,
        text=caption_for(caption, sp.creator.handle), media_url=media_url, media_type=sp.media_type,
    )  # fmt: skip
    sp.status = SourcePost.Status.QUEUED
    sp.save(update_fields=["status"])
    return post


def grant(sp: SourcePost) -> SocialPost:
    """O autor autorizou este post (respondeu ao pedido): registra e põe na fila."""
    sp.permission_granted_at = timezone.now()
    sp.save(update_fields=["permission_granted_at"])
    return enqueue(sp)


def curate(log_line=print) -> SocialPost | None:
    """Avalia os melhores candidatos até achar um repost autorizado; os bons sem autorização viram pedido."""
    SourcePost.objects.filter(
        status=SourcePost.Status.ASK, collected_at__lt=timezone.now() - timedelta(days=ASK_EXPIRES_DAYS)
    ).update(status=SourcePost.Status.SKIPPED, note="pedido de autorização sem resposta")
    asks = 0
    for sp in candidates()[:MAX_TRIES]:
        if sp.media_type == "carousel":
            sp.status, sp.note = SourcePost.Status.SKIPPED, "carrossel ainda não é publicado pela curadoria"
            sp.save(update_fields=["status", "note"])
            continue
        verdict = edit(sp)
        if not verdict.get("approved"):
            sp.status, sp.note = SourcePost.Status.REJECTED, str(verdict.get("reason", ""))[:500]
            sp.save(update_fields=["status", "note"])
            log_line(f"   recusado {sp}: {sp.note}")
            continue
        if not sp.creator.authorized:
            if asks >= MAX_ASKS:
                continue
            sp.status = SourcePost.Status.ASK
            sp.note = str(verdict.get("reason", ""))[:500]
            sp.permission_message = ASK[_lang()].format(handle=sp.creator.handle, url=sp.url)
            sp.save(update_fields=["status", "note", "permission_message"])
            asks += 1
            log_line(f"   pedir autorização: {sp} ({sp.url})")
            continue
        post = enqueue(sp, verdict.get("caption"))
        log_line(f"   na fila: {sp} -> post {post.pk} ({post.get_status_display()})")
        return post
    return None


def publish_next() -> SocialPost | None:
    """Publica no Instagram o repost aprovado mais antigo (um por rodada)."""
    post = (
        SocialPost.objects.filter(status=SocialPost.Status.APPROVED, network=SocialPost.Network.INSTAGRAM,
                                  kind="repost")
        .exclude(media_url="")
        .filter(Q(scheduled_for__isnull=True) | Q(scheduled_for__lte=timezone.now()))
        .order_by("created_at")
        .first()
    )  # fmt: skip
    if post is None:
        return None
    try:
        post.external_id = clients.publish_instagram(post.media_url, post.media_type, post.text)
    except clients.ServiceError as exc:
        post.status, post.error = SocialPost.Status.ERROR, str(exc)[:1000]
        post.save(update_fields=["status", "error", "updated_at"])
        log.warning("Instagram: post %s não saiu: %s", post.pk, exc)
        return post
    post.status, post.error, post.published_at = SocialPost.Status.PUBLISHED, "", timezone.now()
    post.save(update_fields=["status", "error", "external_id", "published_at", "updated_at"])
    return post

