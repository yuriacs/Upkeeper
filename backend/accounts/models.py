from django.conf import settings
from django.db import models


class SocialAccount(models.Model):
    """Conta do Google ou do Discord ligada a uma conta do site (login social)."""

    class Provider(models.TextChoices):
        GOOGLE = "google", "Google"
        DISCORD = "discord", "Discord"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="social_accounts")
    provider = models.CharField("serviço", max_length=20, choices=Provider.choices)
    uid = models.CharField("id no serviço", max_length=255)
    email = models.EmailField("e-mail no serviço", blank=True)
    created_at = models.DateTimeField("ligada em", auto_now_add=True)

    class Meta:
        verbose_name = "conta social"
        verbose_name_plural = "contas sociais"
        constraints = [
            models.UniqueConstraint(fields=["provider", "uid"], name="unique_social_uid"),
            models.UniqueConstraint(fields=["user", "provider"], name="unique_social_per_user"),
        ]

    def __str__(self):
        return f"{self.get_provider_display()} · {self.user}"
