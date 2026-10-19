from django.contrib import admin

from .models import SocialPost


@admin.register(SocialPost)
class SocialPostAdmin(admin.ModelAdmin):
    list_display = ["id", "network", "kind", "lang", "status", "created_at", "published_at"]
    list_filter = ["network", "status", "kind"]
