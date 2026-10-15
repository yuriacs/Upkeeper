from django.contrib import admin

from .models import SocialAccount


@admin.register(SocialAccount)
class SocialAccountAdmin(admin.ModelAdmin):
    list_display = ["user", "provider", "email", "created_at"]
    list_filter = ["provider"]
    search_fields = ["user__username", "email", "uid"]
    raw_id_fields = ["user"]
