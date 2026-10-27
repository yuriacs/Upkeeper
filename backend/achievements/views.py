from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import services


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def new_achievements(request):
    """Conquistas ganhas que o site ainda não avisou (o aviso aparece em qualquer página)."""
    return Response({"achievements": services.unseen(request.user.id)})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def seen_achievements(request):
    """O aviso dessas conquistas já apareceu: {"keys": ["shuffle_up", ...]}."""
    services.mark_seen(request.user.id, request.data.get("keys"))
    return Response({"achievements": services.unseen(request.user.id)})
