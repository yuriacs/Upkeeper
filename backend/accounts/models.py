import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


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
    # Última troca do nome de usuário (no máximo uma a cada USERNAME_COOLDOWN, ver views.me_username)
    username_changed_at = models.DateTimeField(null=True, blank=True, editable=False)
    # Autorizou o nome de usuário a aparecer nos posts do Upkeeper nas redes sociais (ranking etc.)
    social_opt_in = models.BooleanField(default=False)

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


class Avatar(models.Model):
    """
    Foto de perfil (opcional), vista pelos outros jogadores na mesa e no perfil público. Guardada
    já tratada (accounts/avatar.py): quadrada, pequena, em WebP e sem metadados. A chave muda a
    cada envio (o endereço antigo deixa de existir).
    """

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="avatar")
    key = models.UUIDField(default=uuid.uuid4, unique=True)
    image = models.BinaryField(editable=False)
    updated_at = models.DateTimeField(auto_now=True)
    # Escondida pelo admin depois de denúncia (accounts/moderation.py): o endereço dá 404 e a
    # cadeira volta ao ícone. Uma foto nova (se a conta puder enviar) substitui esta.
    hidden_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"foto de {self.user_id}"


class ImageReport(models.Model):
    """
    Denúncia de uma imagem enviada por outro jogador (foto de perfil ou arte personalizada), para
    a fila do painel de admin (accounts/moderation.py). Sem texto livre: só qual imagem, de quem,
    quem denunciou e o que o admin decidiu.
    """

    class Kind(models.IntegerChoices):
        AVATAR = 1, "foto de perfil"
        ART = 2, "arte personalizada"
        PLAYMAT = 3, "fundo da mesa"
        SLEEVE = 4, "sleeve com imagem"

    class Status(models.IntegerChoices):
        OPEN = 0, "aberta"
        HIDDEN = 1, "imagem escondida"
        DISMISSED = 2, "descartada"

    kind = models.PositiveSmallIntegerField(choices=Kind.choices)
    key = models.UUIDField(db_index=True)  # chave do endereço da imagem
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    status = models.PositiveSmallIntegerField(choices=Status.choices, default=Status.OPEN, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "denúncia de imagem"
        verbose_name_plural = "denúncias de imagem"
        constraints = [models.UniqueConstraint(fields=["reporter", "key"], name="unique_image_report")]

    def __str__(self):
        return f"{self.get_kind_display()} {self.key} ({self.get_status_display()})"


class UploadBlock(models.Model):
    """Conta proibida de enviar imagens (foto de perfil e artes), decidido pelo admin numa denúncia."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="upload_block")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "bloqueio de envio de imagens"
        verbose_name_plural = "bloqueios de envio de imagens"

    def __str__(self):
        return f"envio bloqueado: {self.user}"


class Supporter(models.Model):
    """
    Apoiador do site (accounts/supporter.py): quem doou por Pix ou Ko-fi e o admin ativou à mão.
    Cada ativação vale 30 dias (somados ao que faltava). Só libera enfeites (selo, nome dourado,
    sleeve, fundo da mesa, mural): nada de Magic fica pago (Fan Content Policy da Wizards).
    Do pagamento, só o total somado (para o selo de Fundador): sem cada doação, nome no banco ou e-mail.
    """

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="supporter")
    until = models.DateTimeField("apoiador até", db_index=True)
    since = models.DateTimeField("apoiou pela primeira vez", auto_now_add=True)
    times = models.PositiveIntegerField("ativações", default=0)
    # Escolhas do próprio apoiador (ficam guardadas se o apoio vencer e voltam quando renovar)
    sleeve = models.CharField("sleeve", max_length=20, blank=True)
    on_wall = models.BooleanField("aparece no mural", default=False)
    # Soma das doações em centavos (digitada pelo admin ao ativar): só o total, sem cada doação
    total_cents = models.PositiveIntegerField("total doado (centavos)", default=0)
    # Fundador: selo permanente, não vence (supporter.FOUNDER_UNTIL e FOUNDER_TOTAL_CENTS)
    founder_at = models.DateTimeField("fundador desde", null=True, blank=True)
    in_credits = models.BooleanField("aparece nos créditos", default=True)
    # Enfeites de Fundador (valem com o apoio ativo): sleeve foil, moldura animada e título da lista
    foil = models.BooleanField("sleeve foil", default=False)
    frame = models.BooleanField("moldura animada", default=True)
    title = models.CharField("título", max_length=30, blank=True)

    class Meta:
        verbose_name = "apoiador"
        verbose_name_plural = "apoiadores"

    def __str__(self):
        return f"apoiador {self.user_id} até {self.until:%d/%m/%Y}"


class DonationClaim(models.Model):
    """
    Aviso de doação por Pix (accounts/supporter.py): os centavos reservados para a conta (R$ 10,37),
    que aparecem no extrato de quem recebe, e se a pessoa já avisou que pagou. Vai para a fila do
    admin e some ao ativar, ao recusar ou ao vencer. Não guarda valor, nome no banco nem horário do Pix.
    """

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="donation_claim")
    cents = models.PositiveSmallIntegerField("centavos")
    created_at = models.DateTimeField("reservado em", default=timezone.now)
    claimed_at = models.DateTimeField("avisou que doou em", null=True, blank=True, db_index=True)
    # Presente: os 30 dias vão para esta conta em vez de quem pagou
    gift_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )

    class Meta:
        verbose_name = "aviso de doação"
        verbose_name_plural = "avisos de doação"

    def __str__(self):
        return f"aviso de doação {self.user_id} (,{self.cents:02d})"


class Playmat(models.Model):
    """
    Fundo do campo na mesa virtual (perk de apoiador). Como a foto de perfil: guardado já tratado
    (3:1, o formato do campo, em WebP e sem metadados), chave nova a cada envio e moderado por denúncia.
    """

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="playmat")
    key = models.UUIDField(default=uuid.uuid4, unique=True)
    image = models.BinaryField(editable=False)
    updated_at = models.DateTimeField(auto_now=True)
    hidden_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"fundo da mesa de {self.user_id}"


class SleeveArt(models.Model):
    """
    Sleeve com imagem própria (enfeite de Fundador): o verso das cartas viradas na mesa. Como o fundo
    do campo: guardado já tratado (formato de carta, WebP, sem metadados), chave nova a cada envio e
    moderado por denúncia.
    """

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sleeve_art")
    key = models.UUIDField(default=uuid.uuid4, unique=True)
    image = models.BinaryField(editable=False)
    updated_at = models.DateTimeField(auto_now=True)
    hidden_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"sleeve com imagem de {self.user_id}"
