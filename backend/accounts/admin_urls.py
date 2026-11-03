from django.urls import path

from tables import admin_views as table_admin

from . import admin_views

urlpatterns = [
    path("overview/", admin_views.overview, name="admin-overview"),
    path("users/", admin_views.users, name="admin-users"),
    path("request-info/", admin_views.request_info, name="admin-request-info"),
    path("reports/", admin_views.reports, name="admin-reports"),
    path("reports/<uuid:key>/", admin_views.resolve_report, name="admin-report-resolve"),
    path("upload-blocks/<str:username>/", admin_views.upload_block, name="admin-upload-block"),
    path("supporters/", admin_views.supporters, name="admin-supporters"),
    path("donations/", admin_views.donations, name="admin-donations"),
    path("donations/<int:pk>/", admin_views.resolve_donation, name="admin-donation-resolve"),
    path("supporters/<str:username>/", admin_views.supporter_revoke, name="admin-supporter-revoke"),
    path("users/<int:pk>/", admin_views.user_detail, name="admin-user"),
    # Mesas abertas e partidas encerradas (tables/admin_views.py)
    path("tables/", table_admin.live_tables, name="admin-tables"),
    path("tables/<str:code>/", table_admin.end_table, name="admin-table-end"),
    path("games/", table_admin.finished_games, name="admin-games"),
    path("games/<str:source>/<int:pk>/", table_admin.edit_game, name="admin-game"),
]
