from django.urls import path

from . import views

urlpatterns = [
    path("register/", views.register, name="register"),
    path("login/", views.login, name="login"),
    path("logout/", views.logout, name="logout"),
    path("me/", views.me, name="me"),
    path("me/history/reset/", views.reset_history, name="me-history-reset"),
    path("me/export/", views.export_data, name="me-export"),
]
