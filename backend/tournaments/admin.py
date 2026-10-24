from django.contrib import admin

from .models import Tournament


@admin.register(Tournament)
class TournamentAdmin(admin.ModelAdmin):
    list_display = ("name", "kind", "status", "organizer", "created_at")
    list_filter = ("kind", "status")
    search_fields = ("name",)
    raw_id_fields = ("organizer", "champion")
