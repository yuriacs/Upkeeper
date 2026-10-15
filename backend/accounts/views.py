from datetime import timedelta

from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.models import update_last_login
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from config.throttles import AccountThrottle, AuthThrottle, ExportThrottle

from decks.serializers import MyDrawSerializer
from decks.services.draw import reset_user_history
from decks.services.stats import user_stats
from decks.views import my_draws_queryset

from django.contrib.auth.tokens import default_token_generator
from django.db import IntegrityError, transaction
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from django.utils.translation import gettext as _

from . import oauth, privacy
from .mail import send_reset
from .models import PrivateProfile
from .serializers import (
    EmailUpdateSerializer,
    ForgotSerializer,
    LoginSerializer,
    PreloginSerializer,
    RegisterSerializer,
    ResetCheckSerializer,
    ResetSerializer,
    UserSerializer,
    VaultReplaceSerializer,
    VaultUpdateSerializer,
    email_taken,
    profile_of,
    save_vault,
    vault_payload,
)
from .services import delete_account, export_account

User = get_user_model()


def _auth_response(user, status_code=status.HTTP_200_OK):
    update_last_login(None, user)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key, "user": UserSerializer(user).data}, status=status_code)


@api_view(["POST"])
@throttle_classes([AuthThrottle])
def register(request):
    ser = RegisterSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    user = ser.save()
    return _auth_response(user, status.HTTP_201_CREATED)


def _failures_key(username: str) -> str:
    return f"login-failures:{username.lower()[:150]}"


def find_user(login_value: str):
    """Conta pelo nome de usuário ou pela impressão digital do e-mail (se tiver "@")."""
    login_value = login_value.strip()
    if "@" in login_value:
        profile = (
            PrivateProfile.objects.select_related("user")
            .filter(email_digest=privacy.email_digest(login_value))
            .first()
        )
        return profile.user if profile else None
    return User.objects.filter(username__iexact=login_value).first()


@api_view(["POST"])
@throttle_classes([AuthThrottle])
def prelogin(request):
    """
    Antes do login, o navegador pergunta o salt da conta para derivar a chave da senha.
    Conta que não existe recebe um salt falso (sempre o mesmo): não revela quem tem conta.
    "legacy": conta antiga que ainda manda a senha uma última vez para passar para o modo novo.
    """
    ser = PreloginSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    login_value = ser.validated_data["login"]
    user = find_user(login_value)
    profile = profile_of(user) if user else None
    if user and user.has_usable_password() and profile.auth_scheme == PrivateProfile.Scheme.LEGACY:
        return Response({"scheme": "legacy", "salt": None, "iterations": privacy.KDF_ITERATIONS})
    if profile and profile.kdf_salt:
        return Response({"scheme": "derived", "salt": profile.kdf_salt, "iterations": profile.kdf_iterations})
    return Response({"scheme": "derived", "salt": privacy.fake_salt(login_value), "iterations": privacy.KDF_ITERATIONS})


@api_view(["POST"])
@throttle_classes([AuthThrottle])
def login(request):
    ser = LoginSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    data = ser.validated_data
    login_value = data["login"].strip()
    match = find_user(login_value)
    username = match.username if match else login_value
    # Senhas erradas demais nesta conta (de qualquer IP): login dela bloqueado por um tempo
    key = _failures_key(username)
    if cache.get(key, 0) >= settings.LOGIN_MAX_FAILURES:
        return Response(
            {"detail": _("Too many wrong passwords for this account. Try again in a few minutes.")},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )
    secret = data.get("auth_key") or data.get("password")
    user = authenticate(request, username=username, password=secret)
    if user is None:
        try:
            cache.incr(key)
        except ValueError:
            cache.set(key, 1, settings.LOGIN_LOCK_MINUTES * 60)
        return Response({"detail": _("Wrong username or password.")}, status=status.HTTP_400_BAD_REQUEST)
    cache.delete(key)
    profile = profile_of(user)
    upgrade = data.get("upgrade")
    if upgrade and profile.auth_scheme == PrivateProfile.Scheme.LEGACY and data.get("password"):
        # Última vez que esta senha passou pelo servidor: daqui em diante só a chave derivada
        user.set_password(upgrade["auth_key"])
        user.save(update_fields=["password"])
        profile.auth_scheme = PrivateProfile.Scheme.DERIVED
        profile.kdf_salt = upgrade["salt"]
        profile.kdf_iterations = privacy.KDF_ITERATIONS
        # O cofre antigo (se houver) estava trancado com a senha: o navegador cria um novo
        profile.key_by_secret = profile.key_by_recovery = profile.vault = ""
        profile.save()
    return _auth_response(user)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout(request):
    Token.objects.filter(user=request.user).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET", "DELETE"])
@permission_classes([IsAuthenticated])
@throttle_classes([AccountThrottle])
def me(request):
    """
    GET: dados da conta. DELETE {"password"}: exclui a conta e os dados pessoais (LGPD). Conta sem
    senha (criada pelo Google/Discord) confirma digitando o nome de usuário: {"confirm"}.
    """
    if request.method == "DELETE":
        user = request.user
        if user.has_usable_password():
            # Conta nova manda a chave derivada da senha; conta antiga, a senha
            password = request.data.get("auth_key") or request.data.get("password")
            if not isinstance(password, str) or not user.check_password(password):
                return Response({"detail": _("Wrong password.")}, status=status.HTTP_400_BAD_REQUEST)
        else:
            confirm = request.data.get("confirm")
            if not isinstance(confirm, str) or confirm.strip().lower() != user.username.lower():
                return Response(
                    {"detail": _("Type your username to confirm.")}, status=status.HTTP_400_BAD_REQUEST
                )
        delete_account(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)
    # O site chama esta rota ao abrir: conta como "último acesso" (no máximo 1 gravação por hora),
    # já que com o login salvo a pessoa quase nunca digita a senha de novo
    last = request.user.last_login
    if last is None or timezone.now() - last > timedelta(hours=1):
        update_last_login(None, request.user)
    return Response(UserSerializer(request.user).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([ExportThrottle])
def export_data(request):
    """Todos os dados pessoais da conta em JSON (direito de acesso da LGPD)."""
    response = Response(export_account(request.user))
    response["Content-Disposition"] = f'attachment; filename="upkeeper-{request.user.username}.json"'
    return response


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def reset_history(request):
    cleared = reset_user_history(request.user)
    return Response({"cleared": cleared})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_stats(request):
    return Response(user_stats(request.user))


class MyDrawsPagination(PageNumberPagination):
    page_size = 20


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_draws(request):
    """Histórico do jogador: cada sorteio em que ele estava na mesa, do mais recente ao mais antigo."""
    paginator = MyDrawsPagination()
    page = paginator.paginate_queryset(my_draws_queryset(request.user), request)
    return paginator.get_paginated_response(MyDrawSerializer(page, many=True).data)


# ---- login com Google e Discord (accounts/oauth.py) ---------------------------------------


def _oauth_error(code: str):
    return Response({"detail": code, "code": code}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET"])
def oauth_providers(request):
    """Serviços de login configurados no servidor (os botões só aparecem para estes)."""
    return Response({"providers": oauth.enabled(), "password_reset": settings.PASSWORD_RESET_ENABLED})


@api_view(["POST"])
@throttle_classes([AuthThrottle])
def oauth_start(request, provider):
    """{"mode": "login" | "connect"} → {"url", "nonce"}. Ligar a uma conta exige estar logado."""
    mode = "connect" if request.data.get("mode") == "connect" else "login"
    if mode == "connect" and not request.user.is_authenticated:
        return Response(status=status.HTTP_401_UNAUTHORIZED)
    try:
        return Response(oauth.start(provider, mode, request.user.pk if mode == "connect" else None))
    except oauth.OAuthError as err:
        return _oauth_error(err.code)


@api_view(["POST"])
@throttle_classes([AuthThrottle])
def oauth_complete(request, provider):
    """{"code", "state", "nonce"} da volta do serviço → token (login) ou a conta atualizada (ligar)."""
    code, state = request.data.get("code"), request.data.get("state")
    if not isinstance(code, str) or not isinstance(state, str) or not code:
        return _oauth_error("invalid_state")
    try:
        data = oauth.read_state(provider, state, request.data.get("nonce"))
        if data["m"] == "connect":
            # Só a mesma conta que pediu para ligar (o state leva o id dela)
            if not request.user.is_authenticated or request.user.pk != data["u"]:
                return _oauth_error("invalid_state")
            oauth.connect_user(provider, oauth.fetch_profile(provider, code), request.user)
            return Response({"connected": provider, "user": UserSerializer(request.user).data})
        user, created = oauth.login_user(provider, oauth.fetch_profile(provider, code))
    except oauth.OAuthError as err:
        return _oauth_error(err.code)
    return _auth_response(user, status.HTTP_201_CREATED if created else status.HTTP_200_OK)


# ---- e-mail e cofre (accounts/privacy.py) ---------------------------------------------------


@api_view(["PUT"])
@permission_classes([IsAuthenticated])
@throttle_classes([AccountThrottle])
def me_email(request):
    """
    Troca (ou adiciona) o e-mail da conta: o servidor guarda só a impressão digital. A cópia
    legível o navegador põe no cofre. Serve também para conferir: mandar o mesmo e-mail de novo
    responde "matches": true sem mudar nada.
    """
    ser = EmailUpdateSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    email = ser.validated_data["email"]
    profile = profile_of(request.user)
    digest = privacy.email_digest(email)
    if profile.email_digest == digest:
        return Response({"matches": True, "user": UserSerializer(request.user).data})
    if email_taken(email, exclude_user=request.user):
        return Response({"email": [_("There is already an account with this email.")]}, status=400)
    profile.email_digest = digest
    try:
        profile.save(update_fields=["email_digest"])
    except IntegrityError:
        return Response({"email": [_("There is already an account with this email.")]}, status=400)
    return Response({"matches": False, "user": UserSerializer(request.user).data})


@api_view(["GET", "PUT", "PATCH"])
@permission_classes([IsAuthenticated])
def me_vault(request):
    """
    GET: o cofre como está (cifrado). PATCH {data, version}: perfil editado. PUT {key_by_secret,
    key_by_recovery, data, version, salt?}: cofre novo ou trancado de novo (novo código de
    recuperação). O servidor nunca vê a chave nem o conteúdo.
    """
    with transaction.atomic():
        profile = PrivateProfile.objects.select_for_update().select_related("user").get(user=request.user)
        if request.method == "GET":
            return Response(vault_payload(profile))
        if request.method == "PATCH":
            ser = VaultUpdateSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            if not profile.has_vault:
                return Response({"detail": _("Create your private profile first.")}, status=409)
            if ser.validated_data["version"] != profile.vault_version:
                return Response({"detail": _("Your profile changed in another tab. Reload and try again.")}, status=409)
            save_vault(
                profile,
                {"key_by_secret": profile.key_by_secret, "key_by_recovery": profile.key_by_recovery,
                 "data": ser.validated_data["data"]},
            )
            return Response(vault_payload(profile))
        ser = VaultReplaceSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        if data["version"] != profile.vault_version:
            return Response({"detail": _("Your profile changed in another tab. Reload and try again.")}, status=409)
        user = request.user
        salt = None
        if not user.has_usable_password():
            salt = data.get("salt")  # senha do cofre: o salt é dele
            if not salt and not profile.kdf_salt:
                return Response({"salt": [_("This field is required.")]}, status=400)
        elif profile.auth_scheme != PrivateProfile.Scheme.DERIVED or not profile.kdf_salt:
            # Conta antiga ainda logada desde antes: precisa entrar de novo para a senha virar chave
            return Response({"detail": _("Sign out and sign in again to turn on your private profile."),
                             "code": "relogin"}, status=409)
        elif not data.get("auth_key") or not user.check_password(data["auth_key"]):
            return Response({"detail": _("Wrong password."), "code": "wrong_password"}, status=400)
        save_vault(profile, data, salt=salt)
        return Response(vault_payload(profile))


# ---- esqueci a senha --------------------------------------------------------------------------


def _reset_user(uid: str, token: str):
    try:
        pk = int(force_str(urlsafe_base64_decode(uid)))
    except (TypeError, ValueError, OverflowError):
        return None
    user = User.objects.filter(pk=pk, is_active=True).first()
    if user is None or not default_token_generator.check_token(user, token):
        return None
    return user


def _invalid_link():
    return Response(
        {"detail": _("This link is invalid or has expired. Ask for a new one."), "code": "invalid_link"},
        status=status.HTTP_400_BAD_REQUEST,
    )


@api_view(["POST"])
@throttle_classes([AuthThrottle])
def password_forgot(request):
    """
    {"email"} → manda o link para esse endereço, se ele for de alguma conta. A resposta é sempre
    a mesma (não revela se o e-mail tem conta). Um e-mail a cada 2 minutos por conta.
    """
    if not settings.PASSWORD_RESET_ENABLED:
        return Response({"detail": _("Password reset is not available right now.")}, status=503)
    ser = ForgotSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    email = ser.validated_data["email"]
    profile = (
        PrivateProfile.objects.select_related("user")
        .filter(email_digest=privacy.email_digest(email), user__is_active=True)
        .first()
    )
    if profile and cache.add(f"reset-sent:{profile.user_id}", 1, 120):
        send_reset(profile.user, email)
    return Response({"sent": True})


@api_view(["POST"])
@throttle_classes([AuthThrottle])
def password_reset_check(request):
    """O link ainda vale? Devolve o cofre cifrado, para abrir com o código de recuperação."""
    ser = ResetCheckSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    user = _reset_user(ser.validated_data["uid"], ser.validated_data["token"])
    if user is None:
        return _invalid_link()
    profile = profile_of(user)
    return Response({
        "username": user.username,
        "vault": {
            "exists": bool(profile.key_by_recovery),
            "key_by_recovery": profile.key_by_recovery,
            "data": profile.vault,
        },
    })


@api_view(["POST"])
@throttle_classes([AuthThrottle])
def password_reset(request):
    """
    Nova senha: chega a chave derivada dela, o salt novo e o cofre trancado de novo (aberto com o
    código de recuperação) ou um cofre novo e vazio. Desconecta a conta de todos os aparelhos.
    """
    ser = ResetSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    data = ser.validated_data
    with transaction.atomic():
        user = _reset_user(data["uid"], data["token"])
        if user is None:
            return _invalid_link()
        user.set_password(data["auth_key"])
        user.save(update_fields=["password"])  # o link deixa de valer (o token depende da senha)
        profile = PrivateProfile.objects.select_for_update().get(user=user)
        save_vault(profile, data["vault"], salt=data["salt"], scheme=PrivateProfile.Scheme.DERIVED)
        Token.objects.filter(user=user).delete()
    cache.delete(_failures_key(user.username))
    return Response({"username": user.username})
