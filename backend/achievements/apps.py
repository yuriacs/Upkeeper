from django.apps import AppConfig


class AchievementsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "achievements"
    verbose_name = "conquistas"

    def ready(self):
        from . import signals  # noqa: F401
