from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from accounts.profile import public_profile
from accounts.views import avatar_image, playmat_image, sleeve_image, supporters_credits, supporters_wall
from decks.views import (
    DeckViewSet,
    EditionViewSet,
    card_roles,
    commander_arts,
    draw,
    draw_detail,
    draw_result,
    health,
    random_deck,
    stats_overview,
)

router = DefaultRouter()
router.register("editions", EditionViewSet, basename="edition")
router.register("decks", DeckViewSet, basename="deck")

urlpatterns = [
    # Caminho do admin vem do ambiente (ADMIN_PATH): em produção, um que robôs não adivinham
    path(settings.ADMIN_PATH, admin.site.urls),
    path("api/health/", health, name="health"),
    path("api/draw/", draw, name="draw"),
    # Antes do router: senão "random" seria lido como o slug de um deck
    path("api/decks/random/", random_deck, name="random-deck"),
    path("api/draw/<str:code>/", draw_detail, name="draw-detail"),
    path("api/draw/<str:code>/result/", draw_result, name="draw-result"),
    path("api/stats/", stats_overview, name="stats"),
    path("api/cards/roles/", card_roles, name="card-roles"),
    path("api/arts/", commander_arts, name="commander-arts"),
    path("api/auth/", include("accounts.urls")),
    path("api/users/<str:username>/", public_profile, name="public-profile"),
    path("api/avatar/<uuid:key>/", avatar_image, name="avatar"),
    path("api/playmat/<uuid:key>/", playmat_image, name="playmat"),
    path("api/sleeve/<uuid:key>/", sleeve_image, name="sleeve"),
    path("api/supporters/", supporters_wall, name="supporters-wall"),
    path("api/supporters/credits/", supporters_credits, name="supporters-credits"),
    path("api/admin/social/", include("social.urls")),
    path("api/admin/", include("accounts.admin_urls")),
    path("api/rooms/", include("rooms.urls")),
    path("api/tables/", include("tables.urls")),
    path("api/tournaments/", include("tournaments.urls")),
    path("api/achievements/", include("achievements.urls")),
    path("api/", include("pools.urls")),
    path("api/", include(router.urls)),
]
