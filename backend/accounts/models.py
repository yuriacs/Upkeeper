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


class PrivateProfile(models.Model):
    """
    A parte da conta que ninguém do site lê (accounts/privacy.py). Uma por conta.

    Regra do projeto: dado pessoal novo do perfil (nome, cidade, aniversário, redes sociais...)
    vai DENTRO do cofre (`vault`, cifrado no navegador), nunca numa coluna nova legível. Só fica
    fora o que outros jogadores precisam ver (nome de usuário, decks, histórico de partidas).
    O teste accounts/tests/test_privacy.py::SchemaGuardTests falha se aparecer coluna nova.
    """

    class Scheme(models.IntegerChoices):
        LEGACY = 0, "senha enviada ao servidor (contas antigas, até o próximo login)"
        DERIVED = 1, "chave derivada no navegador"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, primary_key=True, related_name="private"
    )
    # HMAC do e-mail: login por e-mail, e-mail repetido e "esqueci a senha"
    email_digest = models.CharField(max_length=64, unique=True, null=True, blank=True, editable=False)
    auth_scheme = models.PositiveSmallIntegerField(choices=Scheme.choices, default=Scheme.LEGACY)
    # Parâmetros do PBKDF2 no navegador (públicos: o navegador pede antes do login)
    kdf_salt = models.CharField(max_length=32, blank=True, editable=False)
    kdf_iterations = models.PositiveIntegerField(default=600_000, editable=False)
    # Chave do cofre trancada pela senha (ou pela senha do cofre, em conta só Google/Discord)...
    key_by_secret = models.CharField(max_length=128, blank=True, editable=False)
    # ...e pelo código de recuperação
    key_by_recovery = models.CharField(max_length=128, blank=True, editable=False)
    # Conteúdo cifrado (AES-256-GCM, base64 de IV + texto cifrado + tag)
    vault = models.TextField(blank=True, editable=False)
    vault_version = models.PositiveIntegerField(default=0, editable=False)
    vault_updated_at = models.DateTimeField(null=True, blank=True, editable=False)

    class Meta:
        verbose_name = "perfil privado (cifrado)"
        verbose_name_plural = "perfis privados (cifrados)"

    def __str__(self):
        return f"perfil privado · {self.user_id}"

    @property
    def has_vault(self) -> bool:
        return bool(self.key_by_secret)


class Friendship(models.Model):
    """
    Pedido de amizade (from_user → to_user) e, depois de aceito, a amizade. Serve para as mesas
    "só amigos". Sem texto nenhum: só as duas contas, se foi aceito e quando.
    """

    from_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="friend_requests_sent")
    to_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="friend_requests_received")
    accepted = models.BooleanField("aceito", default=False, db_index=True)
    created_at = models.DateTimeField("pedido em", auto_now_add=True)
    accepted_at = models.DateTimeField("aceito em", null=True, blank=True)

    class Meta:
        verbose_name = "amizade"
        verbose_name_plural = "amizades"
        constraints = [
            models.UniqueConstraint(fields=["from_user", "to_user"], name="unique_friend_request"),
            models.CheckConstraint(condition=~models.Q(from_user=models.F("to_user")), name="no_self_friendship"),
        ]

    def __str__(self):
        return f"{self.from_user_id} → {self.to_user_id}{' ✓' if self.accepted else ''}"
