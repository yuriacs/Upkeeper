from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from django.utils.translation import gettext as _
from rest_framework import serializers

from . import privacy
from .models import PrivateProfile

User = get_user_model()

# Trocar o nome de usuário: no máximo uma vez nesse intervalo (ninguém some trocando de nome toda hora)
USERNAME_COOLDOWN = timedelta(days=7)


def profile_of(user) -> PrivateProfile:
    try:
        return user.private
    except PrivateProfile.DoesNotExist:
        profile, _ = PrivateProfile.objects.get_or_create(user=user)
        return profile


class UserSerializer(serializers.ModelSerializer):
    """
    Dados da própria conta. Não tem e-mail: ele só existe legível dentro do cofre, que o navegador
    abre sozinho (GET /api/auth/me/vault/).
    """

    is_admin = serializers.BooleanField(source="is_staff", read_only=True)
    # Conta criada pelo Google/Discord não tem senha (exclusão confirma com o nome de usuário)
    has_password = serializers.SerializerMethodField()
    # Serviços ligados para entrar: ["google", "discord"]
    social = serializers.SerializerMethodField()
    # "derived": a senha nunca sai do navegador. "legacy": conta antiga até o próximo login.
    auth_scheme = serializers.SerializerMethodField()
    has_email = serializers.SerializerMethodField()
    has_vault = serializers.SerializerMethodField()
    # Quando dá para trocar o nome de usuário de novo (null = já pode)
    username_next_change = serializers.SerializerMethodField()
    # Aceitou aparecer (pelo nome de usuário) nos posts do Upkeeper nas redes sociais
    social_opt_in = serializers.SerializerMethodField()
    # Foto de perfil (endereço público; null sem foto)
    avatar = serializers.SerializerMethodField()
    # Apoiador (accounts/supporter.py): situação e escolhas dos enfeites
    supporter = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "username", "is_admin", "has_password", "social", "auth_scheme", "has_email", "has_vault",
            "username_next_change", "social_opt_in", "avatar", "supporter",
        ]  # fmt: skip

    def get_supporter(self, user):
        from .supporter import info

        return info(user)

    def get_avatar(self, user):
        from .avatar import avatar_url

        return avatar_url(user)

    def get_has_password(self, user) -> bool:
        return user.has_usable_password()

    def get_social(self, user) -> list[str]:
        return sorted(user.social_accounts.values_list("provider", flat=True))

    def get_auth_scheme(self, user) -> str:
        return "derived" if profile_of(user).auth_scheme == PrivateProfile.Scheme.DERIVED else "legacy"

    def get_has_email(self, user) -> bool:
        return bool(profile_of(user).email_digest)

    def get_has_vault(self, user) -> bool:
        return profile_of(user).has_vault

    def get_social_opt_in(self, user) -> bool:
        return profile_of(user).social_opt_in

    def get_username_next_change(self, user):
        changed = profile_of(user).username_changed_at
        if not changed:
            return None
        nxt = changed + USERNAME_COOLDOWN
        return nxt.isoformat() if nxt > timezone.now() else None


class B64Field(serializers.CharField):
    """Valor binário em base64 vindo do navegador, com tamanho conferido."""

    def __init__(self, *, size=None, max_size=None, min_size=None, **kwargs):
        self.size, self.max_size, self.min_size = size, max_size, min_size
        kwargs.setdefault("max_length", 200_000)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        raw = privacy.b64_bytes(value, size=self.size, max_size=self.max_size)
        if raw is None or (self.min_size and len(raw) < self.min_size):
            raise serializers.ValidationError(_("Invalid encrypted data."))
        return value


def AuthKeyField(**kw):
    return B64Field(size=privacy.AUTH_KEY_BYTES, write_only=True, **kw)


def SaltField(**kw):
    return B64Field(size=privacy.SALT_BYTES, **kw)


class VaultSerializer(serializers.Serializer):
    """Cofre inteiro: chave trancada duas vezes + conteúdo cifrado (tudo feito no navegador)."""

    key_by_secret = B64Field(size=privacy.WRAPPED_KEY_BYTES)
    key_by_recovery = B64Field(size=privacy.WRAPPED_KEY_BYTES)
    # IV (12) + tag (16) no mínimo
    data = B64Field(min_size=28, max_size=privacy.VAULT_MAX_BYTES)


def save_vault(profile: PrivateProfile, vault: dict, *, salt: str | None = None, scheme=None):
    from django.utils import timezone

    profile.key_by_secret = vault["key_by_secret"]
    profile.key_by_recovery = vault["key_by_recovery"]
    profile.vault = vault["data"]
    profile.vault_version += 1
    profile.vault_updated_at = timezone.now()
    if salt:
        profile.kdf_salt = salt
        profile.kdf_iterations = privacy.KDF_ITERATIONS
    if scheme is not None:
        profile.auth_scheme = scheme
    profile.save()


def vault_payload(profile: PrivateProfile) -> dict:
    return {
        "exists": profile.has_vault,
        "salt": profile.kdf_salt,
        "iterations": profile.kdf_iterations,
        "key_by_secret": profile.key_by_secret,
        "key_by_recovery": profile.key_by_recovery,
        "data": profile.vault,
        "version": profile.vault_version,
        # O que tranca o cofre: a senha da conta ou, sem senha (Google/Discord), uma senha do cofre
        "secret": "password" if profile.user.has_usable_password() else "vault_password",
    }


class EmailField(serializers.EmailField):
    def to_internal_value(self, data):
        return privacy.normalize_email(super().to_internal_value(data))


def email_taken(email: str, *, exclude_user=None) -> bool:
    qs = PrivateProfile.objects.filter(email_digest=privacy.email_digest(email))
    if exclude_user is not None:
        qs = qs.exclude(user=exclude_user)
    return qs.exists()


USERNAME_FIELD = dict(
    regex=r"^[\w.-]{3,30}$",
    error_messages={"invalid": _("Use 3 to 30 letters, numbers, dots, hyphens or underscores.")},
)


class UsernameUpdateSerializer(serializers.Serializer):
    username = serializers.RegexField(**USERNAME_FIELD)


class RegisterSerializer(serializers.Serializer):
    """
    Cadastro. A senha não vem: o navegador manda a `auth_key` derivada dela, o `salt` usado e o
    cofre já criado (com o e-mail dentro). O e-mail vem em texto só para virar impressão digital.
    A força da senha é conferida no navegador (o servidor não a vê).
    """

    username = serializers.RegexField(**USERNAME_FIELD)
    email = EmailField()
    auth_key = AuthKeyField()
    salt = SaltField()
    vault = VaultSerializer()

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError(_("This username is already taken."))
        return value

    def validate_email(self, value):
        if email_taken(value):
            raise serializers.ValidationError(_("There is already an account with this email."))
        return value

    def create(self, data):
        user = User(username=data["username"], email=data["email"])  # o sinal troca pela impressão digital
        user.set_password(data["auth_key"])
        user.save()
        save_vault(profile_of(user), data["vault"], salt=data["salt"], scheme=PrivateProfile.Scheme.DERIVED)
        return user


class UpgradeSerializer(serializers.Serializer):
    """Conta antiga entrando pela última vez com a senha: passa para a chave derivada."""

    auth_key = AuthKeyField()
    salt = SaltField()


class LoginSerializer(serializers.Serializer):
    login = serializers.CharField(help_text="Nome de usuário ou e-mail", max_length=254)
    # Contas novas mandam a chave derivada; contas antigas (até o primeiro login) mandam a senha
    auth_key = serializers.CharField(write_only=True, required=False, max_length=128)
    password = serializers.CharField(write_only=True, required=False, max_length=128)
    upgrade = UpgradeSerializer(required=False)

    def validate(self, data):
        if not data.get("auth_key") and not data.get("password"):
            raise serializers.ValidationError({"password": [_("This field is required.")]})
        return data


class PreloginSerializer(serializers.Serializer):
    login = serializers.CharField(max_length=254)


class EmailUpdateSerializer(serializers.Serializer):
    email = EmailField()


class VaultUpdateSerializer(serializers.Serializer):
    """Só o conteúdo (perfil editado): exige a versão atual, para duas abas não se atropelarem."""

    data = B64Field(min_size=28, max_size=privacy.VAULT_MAX_BYTES)
    version = serializers.IntegerField(min_value=0)


class VaultReplaceSerializer(VaultSerializer):
    """
    Cofre novo ou trancado de novo (novo código de recuperação). O salt só é aceito em conta sem
    senha (senha do cofre); nas outras ele é o mesmo do login e não muda aqui.
    """

    salt = SaltField(required=False)
    version = serializers.IntegerField(min_value=0)
    # Conta com senha prova que digitou a senha certa: senão o cofre ficaria trancado com uma
    # senha errada (e quem roubasse o token poderia trocar o cofre)
    auth_key = AuthKeyField(required=False)


class ForgotSerializer(serializers.Serializer):
    email = EmailField()


class ResetCheckSerializer(serializers.Serializer):
    uid = serializers.CharField(max_length=64)
    token = serializers.CharField(max_length=128)


class ResetSerializer(ResetCheckSerializer):
    auth_key = AuthKeyField()
    salt = SaltField()
    vault = VaultSerializer()
