from django.urls import path

from . import views

urlpatterns = [
    path("mine/", views.my_tables, name="my-tables"),
    path("open/", views.open_tables, name="open-tables"),
]
