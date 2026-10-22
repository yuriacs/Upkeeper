"""
Fila de posts do Upkeeper para as redes sociais (Instagram e X). Fase 1: o painel gera rascunhos
a partir dos dados do site (social/feed.py), o admin edita, aprova e publica à mão.

Fase 2 (curadoria, social/curation.py): monitora perfis do nicho (Creator), guarda os posts deles
(SourcePost) e só reposta mídia de quem autorizou. O repost entra na mesma fila como rascunho e,
depois de aprovado, sai sozinho pela API oficial do Instagram (social/clients.py).
"""

from django.conf import settings
from django.db import models
from django.utils import timezone


class SocialPost(models.Model):
    class Network(models.TextChoices):
        INSTAGRAM = "instagram", "Instagram"
        X = "x", "X"

    class Status(models.TextChoices):
        DRAFT = "draft", "rascunho"
        APPROVED = "approved", "aprovado"
        PUBLISHED = "published", "publicado"
        ERROR = "error", "erro"

    network = models.CharField("rede", max_length=12, choices=Network.choices)
    # ranking, precon, numbers, news, repost ou custom (escrito à mão)
    kind = models.CharField("tipo", max_length=20, default="custom")
    lang = models.CharField("idioma", max_length=5, default="pt")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT, db_index=True)
    text = models.TextField("texto", blank=True)
    # Imagens do post como especificação (modelo + dados); o painel desenha e exporta em PNG
    slides = models.JSONField("imagens", default=list, blank=True)
    # Repost: a mídia já hospedada (Cloudinary), que a API do Instagram baixa ao publicar
    source = models.ForeignKey(
        "SourcePost", on_delete=models.SET_NULL, null=True, blank=True, related_name="posts", verbose_name="original"
    )
    media_url = models.URLField("mídia", max_length=500, blank=True)
    media_type = models.CharField("tipo de mídia", max_length=8, blank=True)  # image ou video
    external_id = models.CharField("id na rede", max_length=40, blank=True)
    error = models.TextField("erro", blank=True)
    scheduled_for = models.DateTimeField("agendado para", null=True, blank=True)
    published_at = models.DateTimeField("publicado em", null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "post das redes"
        verbose_name_plural = "posts das redes"

    def __str__(self):
        return f"{self.get_network_display()} · {self.kind} · {self.get_status_display()}"


class Creator(models.Model):
    """Perfil público do nicho que a curadoria acompanha. Só se reposta de quem autorizou."""

    handle = models.CharField("@ no Instagram", max_length=40, unique=True)
    active = models.BooleanField("monitorar", default=True)
    followers = models.PositiveIntegerField("seguidores", default=0)
    # Autorização para repostar qualquer post do perfil (com crédito). Sem ela, cada post
    # escolhido vira um pedido (SourcePost.Status.ASK) e só segue depois do "sim".
    authorized = models.BooleanField("autorizou repost", default=False)
    authorized_at = models.DateTimeField("autorizou em", null=True, blank=True)
    authorization_note = models.TextField("como autorizou", blank=True)  # ex.: "DM em 21/10, print no Drive"
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["handle"]
        verbose_name = "perfil monitorado"
        verbose_name_plural = "perfis monitorados"

    def __str__(self):
        return f"@{self.handle}"

    @staticmethod
    def clean_handle(value: str) -> str:
        """"@Perfil", "instagram.com/perfil/" ou "perfil" -> "perfil"."""
        value = value.strip().rstrip("/").rsplit("/", 1)[-1]
        return value.lstrip("@").lower()

    def set_authorized(self, value: bool):
        if value and not self.authorized_at:
            self.authorized_at = timezone.now()
        elif not value:
            self.authorized_at = None
        self.authorized = value


class SourcePost(models.Model):
    """Post de um perfil monitorado, como veio da coleta. O shortcode impede repost duplicado."""

    class Status(models.TextChoices):
        NEW = "new", "coletado"
        ASK = "ask", "pedir autorização"
        QUEUED = "queued", "na fila"
        REJECTED = "rejected", "recusado pela IA"
        SKIPPED = "skipped", "descartado"

    creator = models.ForeignKey(Creator, on_delete=models.CASCADE, related_name="posts", verbose_name="perfil")
    shortcode = models.CharField(max_length=40, unique=True)
    url = models.URLField(max_length=300)
    media_type = models.CharField("tipo de mídia", max_length=8)  # image, video ou carousel
    # Link assinado do CDN do Instagram: passa fácil de 1000 caracteres (e expira em dias)
    media_url = models.TextField("mídia original", blank=True)
    caption = models.TextField("legenda original", blank=True)
    likes = models.PositiveIntegerField("curtidas", default=0)
    comments = models.PositiveIntegerField("comentários", default=0)
    posted_at = models.DateTimeField("postado em")
    # (curtidas + comentários) / seguidores, e quantas vezes isso é a mediana do próprio perfil
    engagement = models.FloatField("engajamento", default=0)
    outlier = models.FloatField("acima da mediana", default=0)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.NEW, db_index=True)
    note = models.TextField("observação", blank=True)  # motivo da IA ou do descarte
    # Mensagem pronta para pedir autorização por DM (status ASK)
    permission_message = models.TextField("pedido de autorização", blank=True)
    permission_granted_at = models.DateTimeField("autorizado em", null=True, blank=True)
    collected_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-posted_at"]
        verbose_name = "post coletado"
        verbose_name_plural = "posts coletados"

    def __str__(self):
        return f"@{self.creator.handle} · {self.shortcode}"
