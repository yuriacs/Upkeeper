from datetime import timedelta

from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.models import update_last_login
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

from .serializers import LoginSerializer, PasswordConfirmSerializer, RegisterSerializer, UserSerializer
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
    user = authenticate(request, username=username, password=ser.validated_data["password"])
    if user is None:
        return Response({"detail": _("Wrong username or password.")}, status=status.HTTP_400_BAD_REQUEST)
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
    """GET: dados da conta. DELETE {"password"}: exclui a conta e os dados pessoais (LGPD)."""
    if request.method == "DELETE":
        ser = PasswordConfirmSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        if not request.user.check_password(ser.validated_data["password"]):
            return Response({"detail": _("Wrong password.")}, status=status.HTTP_400_BAD_REQUEST)
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
