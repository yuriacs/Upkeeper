from django.urls import path

from . import views

urlpatterns = [
    path("", views.tournaments, name="tournaments"),
    path("<int:pk>/", views.tournament_detail, name="tournament"),
    path("<int:pk>/join/", views.join, name="tournament-join"),
    path("<int:pk>/leave/", views.leave, name="tournament-leave"),
    path("<int:pk>/start/", views.start, name="tournament-start"),
    path("<int:pk>/entries/<int:entry_id>/drop/", views.drop, name="tournament-drop"),
    path("<int:pk>/matches/<int:match_id>/result/", views.result, name="tournament-result"),
]
