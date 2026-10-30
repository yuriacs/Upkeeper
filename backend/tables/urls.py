from django.urls import path

from . import views

urlpatterns = [
    path("mine/", views.my_tables, name="my-tables"),
    path("open/", views.open_tables, name="open-tables"),
    path("replays/", views.my_replays, name="my-replays"),
    path("replays/<int:pk>/", views.replay_detail, name="replay"),
    path("replays/<int:pk>/restore/", views.restore_replay, name="replay-restore"),
]
