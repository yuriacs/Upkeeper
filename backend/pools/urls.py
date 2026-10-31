from django.urls import path

from . import generator, views

urlpatterns = [
    path("generator/", generator.generator_info, name="generator"),
    path("generator/describe/", generator.generator_describe, name="generator-describe"),
    path("generator/guide/", generator.generator_guide, name="generator-guide"),
    path("generator/stats/", generator.generator_stats, name="generator-stats"),
    path("generator/usage/", generator.generator_usage, name="generator-usage"),
    path("me/card-pool/", generator.my_card_pool, name="my-card-pool"),
    path("me/precons/", views.my_precons, name="my-precons"),
    path("me/precons/<slug:slug>/", views.my_precon, name="my-precon"),
    path("me/decks/", views.my_decks, name="my-decks"),
    path("me/decks/<int:pk>/", views.my_deck, name="my-deck"),
    path("me/decks/from-url/", views.deck_from_url, name="my-deck-from-url"),
    path("user-decks/<int:pk>/", views.user_deck_public, name="user-deck"),
    path("me/favorite-cards/", views.my_favorites, name="my-favorites"),
    path("me/card-arts/", views.my_card_arts, name="my-card-arts"),
    path("me/card-arts/<uuid:key>/", views.my_card_art, name="my-card-art"),
    path("me/token-arts/", views.my_token_arts, name="my-token-arts"),
    path("deck-estimate/", views.deck_estimate, name="deck-estimate"),
    path("me/decks/<int:pk>/arts/", views.my_deck_art, name="my-deck-art"),
    path("card-art/<uuid:key>/", views.card_art_image, name="card-art"),
    path("card-arts/<uuid:oracle_id>/", views.card_arts, name="card-arts"),
    path("me/favorite-cards/<uuid:oracle_id>/", views.my_favorite, name="my-favorite"),
]
