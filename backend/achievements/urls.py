from django.urls import path

from . import views

urlpatterns = [
    path("new/", views.new_achievements, name="achievements-new"),
    path("seen/", views.seen_achievements, name="achievements-seen"),
]
