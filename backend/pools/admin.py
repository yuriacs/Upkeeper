from django.contrib import admin

from .models import OwnedPrecon, UserDeck, UserDeckCard


class UserDeckCardInline(admin.TabularInline):
    model = UserDeckCard
    extra = 0
    raw_id_fields = ["card"]


@admin.register(UserDeck)
class UserDeckAdmin(admin.ModelAdmin):
    list_display = ["name", "owner", "color_identity", "updated_at"]
    search_fields = ["name", "owner__username"]
    raw_id_fields = ["face_commander"]
    inlines = [UserDeckCardInline]


@admin.register(OwnedPrecon)
class OwnedPreconAdmin(admin.ModelAdmin):
    list_display = ["user", "deck", "created_at"]
    search_fields = ["user__username", "deck__name"]
    raw_id_fields = ["deck"]
