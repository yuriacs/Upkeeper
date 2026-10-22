from django.contrib import admin, messages
from django.utils import timezone

from . import curation
from .clients import ServiceError
from .models import Creator, SocialPost, SourcePost


@admin.register(SocialPost)
class SocialPostAdmin(admin.ModelAdmin):
    list_display = ["id", "network", "kind", "lang", "status", "created_at", "published_at"]
    list_filter = ["network", "status", "kind"]
    raw_id_fields = ["source"]


@admin.register(Creator)
class CreatorAdmin(admin.ModelAdmin):
    list_display = ["handle", "active", "followers", "authorized", "authorized_at"]
    list_filter = ["active", "authorized"]
    search_fields = ["handle"]
    readonly_fields = ["followers", "created_at"]

    def save_model(self, request, obj, form, change):
        obj.handle = obj.handle.strip().lstrip("@").lower()
        if obj.authorized and not obj.authorized_at:
            obj.authorized_at = timezone.now()
        elif not obj.authorized:
            obj.authorized_at = None
        super().save_model(request, obj, form, change)


@admin.register(SourcePost)
class SourcePostAdmin(admin.ModelAdmin):
    list_display = ["shortcode", "creator", "media_type", "likes", "comments", "engagement", "outlier", "status", "posted_at"]
    list_filter = ["status", "media_type", "creator"]
    search_fields = ["shortcode", "creator__handle"]
    readonly_fields = [f.name for f in SourcePost._meta.concrete_fields if f.name != "status"]
    actions = ["granted", "discard"]

    @admin.action(description="O autor autorizou este post: mandar para a fila")
    def granted(self, request, queryset):
        for sp in queryset.select_related("creator"):
            try:
                post = curation.grant(sp)
            except ServiceError as exc:
                self.message_user(request, f"{sp}: {exc}", messages.ERROR)
            else:
                self.message_user(request, f"{sp}: post {post.pk} na fila do painel")

    @admin.action(description="Descartar (não repostar)")
    def discard(self, request, queryset):
        queryset.update(status=SourcePost.Status.SKIPPED, note="descartado no admin")
