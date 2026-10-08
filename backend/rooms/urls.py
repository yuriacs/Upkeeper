from django.urls import path

from . import views

urlpatterns = [
    path("", views.create_room, name="room-create"),
    path("<str:code>/", views.room_detail, name="room-detail"),
    path("<str:code>/join/", views.join, name="room-join"),
    path("<str:code>/leave/", views.leave, name="room-leave"),
    path("<str:code>/kick/", views.kick, name="room-kick"),
    path("<str:code>/draw/", views.draw, name="room-draw"),
]
