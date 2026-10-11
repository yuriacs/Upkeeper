from django.urls import re_path

from .consumers import TableConsumer

websocket_urlpatterns = [
    re_path(r"^ws/tables/(?P<code>[A-Za-z0-9]{1,32})/$", TableConsumer.as_asgi()),
]
