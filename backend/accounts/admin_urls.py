from django.urls import path

from . import admin_views

urlpatterns = [
    path("overview/", admin_views.overview, name="admin-overview"),
    path("users/", admin_views.users, name="admin-users"),
]
