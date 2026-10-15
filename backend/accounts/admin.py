from django.contrib import admin

from .models import SocialAccount


@admin.register(SocialAccount)
class SocialAccountAdmin(admin.ModelAdmin):
    list_display = ["user", "provider", "created_at"]
    list_filter = ["provider"]
    search_fields = ["user__username", "uid"]
    raw_id_fields = ["user"]

# PrivateProfile fica de fora do admin de propósito: o que tem lá é ilegível (cifrado ou HMAC).
