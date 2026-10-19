"""
Fila de posts do Upkeeper para as redes sociais (Instagram e X). Fase 1: o painel gera rascunhos
a partir dos dados do site (social/feed.py), o admin edita, aprova e publica à mão; a publicação
automática pelas APIs das redes vem depois.
"""

from django.conf import settings
from django.db import models


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
    # ranking, precon, numbers, news ou custom (escrito à mão)
    kind = models.CharField("tipo", max_length=20, default="custom")
    lang = models.CharField("idioma", max_length=5, default="pt")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT, db_index=True)
    text = models.TextField("texto", blank=True)
    # Imagens do post como especificação (modelo + dados); o painel desenha e exporta em PNG
    slides = models.JSONField("imagens", default=list, blank=True)
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
