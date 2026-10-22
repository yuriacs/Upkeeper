from django.urls import path

from . import views

urlpatterns = [
    path("feed/", views.feed, name="social-feed"),
    path("posts/", views.posts, name="social-posts"),
    path("posts/generate/", views.generate, name="social-generate"),
    path("posts/<int:pk>/", views.post_detail, name="social-post"),
    path("posts/<int:pk>/publish/", views.publish_now, name="social-publish"),
    path("posts/<int:pk>/media/", views.upload_media, name="social-media"),
    path("repost/", views.repost, name="social-repost"),
    path("creators/", views.creators, name="social-creators"),
    path("creators/<int:pk>/", views.creator_detail, name="social-creator"),
    path("requests/", views.requests, name="social-requests"),
    path("requests/<int:pk>/<str:action>/", views.request_action, name="social-request-action"),
]
