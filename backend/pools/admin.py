from django.contrib import admin

from .models import GeneratorDay, OwnedPrecon, UserDeck, UserDeckCard


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


@admin.register(GeneratorDay)
class GeneratorDayAdmin(admin.ModelAdmin):
    # Somas por dia do gerador de decks (o painel do site mostra os mesmos números, com as médias)
    list_display = ["day", "done", "failed", "cancelled", "saved", "ai_describe", "ai_guide", "tokens_in", "tokens_out"]
