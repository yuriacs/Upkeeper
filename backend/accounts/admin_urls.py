from django.urls import path

from . import admin_views

urlpatterns = [
    path("overview/", admin_views.overview, name="admin-overview"),
    path("users/", admin_views.users, name="admin-users"),
    path("request-info/", admin_views.request_info, name="admin-request-info"),
    path("reports/", admin_views.reports, name="admin-reports"),
    path("reports/<uuid:key>/", admin_views.resolve_report, name="admin-report-resolve"),
    path("upload-blocks/<str:username>/", admin_views.upload_block, name="admin-upload-block"),
    path("supporters/", admin_views.supporters, name="admin-supporters"),
    path("supporters/<str:username>/", admin_views.supporter_revoke, name="admin-supporter-revoke"),
]
