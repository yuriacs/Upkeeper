from django.contrib import admin

from .models import Room, RoomPlayer


class RoomPlayerInline(admin.TabularInline):
    model = RoomPlayer
    extra = 0
    readonly_fields = ["name", "user", "joined_at"]
    exclude = ["token"]


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ["code", "mode", "round", "created_at"]
    readonly_fields = ["code", "draw", "draw_seats", "reveal_at", "round"]
    raw_id_fields = ["host"]
    inlines = [RoomPlayerInline]
