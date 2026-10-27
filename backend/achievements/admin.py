from django.contrib import admin

from .models import UserAchievement


@admin.register(UserAchievement)
class UserAchievementAdmin(admin.ModelAdmin):
    list_display = ("user", "key", "progress", "earned_at")
    list_filter = ("key",)
    search_fields = ("user__username",)
    raw_id_fields = ("user",)
    readonly_fields = ("data",)
