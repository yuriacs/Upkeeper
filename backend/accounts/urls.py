from django.urls import path

from . import views

urlpatterns = [
    path("register/", views.register, name="register"),
    path("prelogin/", views.prelogin, name="prelogin"),
    path("login/", views.login, name="login"),
    path("logout/", views.logout, name="logout"),
    path("me/", views.me, name="me"),
    path("me/history/reset/", views.reset_history, name="me-history-reset"),
    path("me/draws/", views.my_draws, name="me-draws"),
    path("me/stats/", views.my_stats, name="me-stats"),
    path("me/export/", views.export_data, name="me-export"),
    path("me/email/", views.me_email, name="me-email"),
    path("me/vault/", views.me_vault, name="me-vault"),
    path("password/forgot/", views.password_forgot, name="password-forgot"),
    path("password/reset/check/", views.password_reset_check, name="password-reset-check"),
    path("password/reset/", views.password_reset, name="password-reset"),
    path("oauth/providers/", views.oauth_providers, name="oauth-providers"),
    path("oauth/<str:provider>/start/", views.oauth_start, name="oauth-start"),
    path("oauth/<str:provider>/complete/", views.oauth_complete, name="oauth-complete"),
]
