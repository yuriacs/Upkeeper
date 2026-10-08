from django.contrib import admin
from django.db.models import Count, Sum
from django.utils.html import format_html

from .models import Card, Deck, DeckCard, Draw, DrawEntry, Edition


@admin.register(Edition)
class EditionAdmin(admin.ModelAdmin):
    list_display = ["code", "name", "release_date", "deck_count"]
    search_fields = ["code", "name"]

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_decks=Count("decks"))

    @admin.display(description="decks", ordering="_decks")
    def deck_count(self, obj):
        return obj._decks


class DeckCardInline(admin.TabularInline):
    model = DeckCard
    extra = 0
    raw_id_fields = ["card"]
    fields = ["quantity", "card", "is_commander"]
    ordering = ["-is_commander", "card__category", "card__name"]


@admin.register(Deck)
class DeckAdmin(admin.ModelAdmin):
    list_display = ["name", "edition", "release_date", "color_identity", "face_commander", "card_total", "is_active"]
    list_filter = ["is_active", "edition", "color_identity"]
    list_editable = ["is_active"]
    search_fields = ["name", "face_commander__name", "edition__name", "edition__code"]
    raw_id_fields = ["face_commander"]
    readonly_fields = ["mtgjson_file", "created_at", "updated_at"]
    prepopulated_fields = {"slug": ["name"]}
    inlines = [DeckCardInline]
    actions = ["activate", "deactivate"]

    def get_queryset(self, request):
        return (
            super().get_queryset(request)
            .select_related("edition", "face_commander")
            .annotate(_total=Sum("deck_cards__quantity"))
        )

    @admin.display(description="cartas", ordering="_total")
    def card_total(self, obj):
        return obj._total

    @admin.action(description="Colocar no sorteio")
    def activate(self, request, queryset):
        queryset.update(is_active=True)

    @admin.action(description="Tirar do sorteio")
    def deactivate(self, request, queryset):
        queryset.update(is_active=False)


@admin.register(Card)
class CardAdmin(admin.ModelAdmin):
    list_display = ["name", "type_line", "category", "color_identity", "set_code", "has_image"]
    list_filter = ["category", "color_identity", "rarity"]
    search_fields = ["name", "type_line"]
    readonly_fields = ["preview", "scryfall_synced_at"]

    @admin.display(description="imagem", boolean=True)
    def has_image(self, obj):
        return bool(obj.image_normal)

    @admin.display(description="prévia")
    def preview(self, obj):
        if not obj.image_normal:
            return "—"
        return format_html('<img src="{}" style="max-width:244px;border-radius:12px">', obj.image_normal)


class DrawEntryInline(admin.TabularInline):
    model = DrawEntry
    extra = 0
    can_delete = False
    readonly_fields = ["position", "player_name", "deck"]


@admin.register(Draw)
class DrawAdmin(admin.ModelAdmin):
    list_display = ["code", "created_at", "pool_size"]
    readonly_fields = ["code", "created_at", "pool_size", "filters"]
    search_fields = ["code", "entries__player_name"]
    inlines = [DrawEntryInline]

    def has_add_permission(self, request):
        return False
