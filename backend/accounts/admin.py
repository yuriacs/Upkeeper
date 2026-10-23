from django.contrib import admin

from .models import ImageReport, SocialAccount, Supporter, UploadBlock


@admin.register(SocialAccount)
class SocialAccountAdmin(admin.ModelAdmin):
    list_display = ["user", "provider", "created_at"]
    list_filter = ["provider"]
    search_fields = ["user__username", "uid"]
    raw_id_fields = ["user"]

# PrivateProfile fica de fora do admin de propósito: o que tem lá é ilegível (cifrado ou HMAC).


@admin.register(ImageReport)
class ImageReportAdmin(admin.ModelAdmin):
    list_display = ["key", "kind", "owner", "reporter", "status", "created_at"]
    list_filter = ["kind", "status"]
    search_fields = ["owner__username", "reporter__username"]
    raw_id_fields = ["owner", "reporter"]


@admin.register(UploadBlock)
class UploadBlockAdmin(admin.ModelAdmin):
    list_display = ["user", "created_at"]
    search_fields = ["user__username"]
    raw_id_fields = ["user"]


@admin.register(Supporter)
class SupporterAdmin(admin.ModelAdmin):
    list_display = ["user", "until", "since", "times", "total_cents", "founder_at", "sleeve", "foil", "title"]
    search_fields = ["user__username"]
    raw_id_fields = ["user"]
