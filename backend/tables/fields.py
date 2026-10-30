"""Campo de JSON guardado compactado (zlib), lido e gravado como dict pelo resto do código."""

import json
import zlib

from django.db import models


class ZlibJSONField(models.BinaryField):
    """
    O estado da mesa é regravado a cada poucos segundos e repete muito (textos das cartas, fotos
    dos turnos): compactado, cada gravação manda ao banco uma fração do tamanho em JSON puro.
    """

    def from_db_value(self, value, expression, connection):
        if value is None:
            return None
        return json.loads(zlib.decompress(bytes(value)))

    def to_python(self, value):
        if isinstance(value, (bytes, bytearray, memoryview)):
            return json.loads(zlib.decompress(bytes(value)))
        return value

    def get_prep_value(self, value):
        if value is None or isinstance(value, (bytes, bytearray, memoryview)):
            return value
        return zlib.compress(json.dumps(value, separators=(",", ":")).encode(), 6)

    def value_to_string(self, obj):
        return json.dumps(self.value_from_object(obj))
