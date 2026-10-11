from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from decks.views import DeckViewSet, EditionViewSet, draw, commander_arts, draw_detail, draw_result, health, stats_overview

router = DefaultRouter()
router.register("editions", EditionViewSet, basename="edition")
router.register("decks", DeckViewSet, basename="deck")

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health, name="health"),
    path("api/draw/", draw, name="draw"),
    path("api/draw/<str:code>/", draw_detail, name="draw-detail"),
    path("api/draw/<str:code>/result/", draw_result, name="draw-result"),
    path("api/stats/", stats_overview, name="stats"),
    path("api/arts/", commander_arts, name="commander-arts"),
    path("api/auth/", include("accounts.urls")),
    path("api/admin/", include("accounts.admin_urls")),
    path("api/rooms/", include("rooms.urls")),
    path("api/tables/", include("tables.urls")),
    path("api/", include("pools.urls")),
    path("api/", include(router.urls)),
]
