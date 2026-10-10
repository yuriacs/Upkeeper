import secrets


def can_set_result(request, draw) -> bool:
    """
    Quem pode marcar o vencedor de um sorteio:
    - quem criou (com conta, ou sem conta guardando o token devolvido na criação);
    - qualquer jogador com conta que estava na mesa;
    - qualquer jogador da sala onde o sorteio aconteceu.
    """
    token = request.headers.get("X-Draw-Token", "")
    if token and draw.manage_token and secrets.compare_digest(token, draw.manage_token):
        return True
    user = request.user
    if user.is_authenticated:
        if draw.created_by_id == user.pk:
            return True
        if any(e.player_id == user.pk for e in draw.entries.all()):
            return True
    room_token = request.headers.get("X-Room-Token", "")
    if room_token and draw.room_id:
        from rooms.models import RoomPlayer

        return RoomPlayer.objects.filter(room_id=draw.room_id, token=room_token).exists()
    return False
