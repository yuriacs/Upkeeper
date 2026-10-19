from django.urls import path

from . import views

urlpatterns = [
    path("me/precons/", views.my_precons, name="my-precons"),
    path("me/precons/<slug:slug>/", views.my_precon, name="my-precon"),
    path("me/decks/", views.my_decks, name="my-decks"),
    path("me/decks/<int:pk>/", views.my_deck, name="my-deck"),
    path("user-decks/<int:pk>/", views.user_deck_public, name="user-deck"),
    path("me/favorite-cards/", views.my_favorites, name="my-favorites"),
    path("me/favorite-cards/<uuid:oracle_id>/", views.my_favorite, name="my-favorite"),
]
