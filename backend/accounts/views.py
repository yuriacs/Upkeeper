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

from . import oauth
from .serializers import LoginSerializer, RegisterSerializer, UserSerializer
from .services import delete_account, export_account
from django.utils.translation import gettext as _

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


@api_view(["POST"])
@throttle_classes([AuthThrottle])
def login(request):
    ser = LoginSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    login_value = ser.validated_data["login"].strip()
    username = login_value
    if "@" in login_value:
        match = User.objects.filter(email__iexact=login_value).first()
        username = match.username if match else login_value
    else:
        match = User.objects.filter(username__iexact=login_value).first()
        username = match.username if match else login_value
    # Senhas erradas demais nesta conta (de qualquer IP): login dela bloqueado por um tempo
    key = _failures_key(username)
    if cache.get(key, 0) >= settings.LOGIN_MAX_FAILURES:
        return Response(
            {"detail": _("Too many wrong passwords for this account. Try again in a few minutes.")},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )
    user = authenticate(request, username=username, password=ser.validated_data["password"])
    if user is None:
        try:
            cache.incr(key)
        except ValueError:
            cache.set(key, 1, settings.LOGIN_LOCK_MINUTES * 60)
        return Response({"detail": _("Wrong username or password.")}, status=status.HTTP_400_BAD_REQUEST)
    cache.delete(key)
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
            password = request.data.get("password")
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
    return Response({"providers": oauth.enabled()})


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
