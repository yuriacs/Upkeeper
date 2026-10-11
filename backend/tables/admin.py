from django.contrib import admin

from .models import TableGame


@admin.register(TableGame)
class TableGameAdmin(admin.ModelAdmin):
    list_display = ("code", "updated_at")
    search_fields = ("code",)
    readonly_fields = ("code", "data", "updated_at")
