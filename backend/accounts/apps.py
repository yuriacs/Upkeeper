from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "accounts"

    def ready(self):
        from config import dbawake

        from . import signals  # noqa: F401

        dbawake.install()  # compute do Neon estimado (painel do admin)
