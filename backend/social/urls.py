from django.urls import path

from . import views

urlpatterns = [
    path("feed/", views.feed, name="social-feed"),
    path("posts/", views.posts, name="social-posts"),
    path("posts/generate/", views.generate, name="social-generate"),
    path("posts/<int:pk>/", views.post_detail, name="social-post"),
]
