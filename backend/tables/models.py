from django.db import models


class TableGame(models.Model):
    """Mesa virtual salva a cada ação, para sobreviver a um reinício do servidor (tables/state.py)."""

    code = models.CharField("código", max_length=12, primary_key=True)
    data = models.JSONField("estado")
    updated_at = models.DateTimeField("atualizada em", auto_now=True, db_index=True)

    class Meta:
        verbose_name = "mesa virtual"
        verbose_name_plural = "mesas virtuais"

    def __str__(self):
        return self.code
