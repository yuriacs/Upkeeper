from django.conf import settings
from django.db import models


class UserAchievement(models.Model):
    """
    Conquista de uma conta (achievements/catalog.py): o progresso até a meta e quando foi ganha.
    `data`: o que precisa ser lembrado até ganhar (cores já vencidas, pessoas com quem jogou,
    grupos de mesa); esvazia ao ganhar. `seen`: o aviso de conquista nova já apareceu no site.
    """

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="achievements")
    key = models.CharField("conquista", max_length=32)
    progress = models.PositiveIntegerField("progresso", default=0)
    data = models.JSONField(default=dict, blank=True)
    earned_at = models.DateTimeField("ganha em", null=True, blank=True)
    seen = models.BooleanField("aviso visto", default=False)

    class Meta:
        verbose_name = "conquista"
        verbose_name_plural = "conquistas"
        constraints = [models.UniqueConstraint(fields=["user", "key"], name="unique_user_achievement")]
        indexes = [models.Index(fields=["user", "seen"], name="achievement_user_seen")]

    def __str__(self):
        return f"{self.user_id}: {self.key}"
