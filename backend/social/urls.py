from django.urls import path

from . import views

urlpatterns = [
    path("feed/", views.feed, name="social-feed"),
    path("posts/", views.posts, name="social-posts"),
    path("posts/generate/", views.generate, name="social-generate"),
    path("posts/<int:pk>/", views.post_detail, name="social-post"),
    path("creators/", views.creators, name="social-creators"),
    path("creators/<int:pk>/", views.creator_detail, name="social-creator"),
    path("requests/", views.requests, name="social-requests"),
    path("requests/<int:pk>/<str:action>/", views.request_action, name="social-request-action"),
]
