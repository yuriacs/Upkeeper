import django_filters
from django.db.models import Q

from .models import Deck, normalize_colors


class DeckFilter(django_filters.FilterSet):
    edition = django_filters.CharFilter(method="filter_edition", help_text="Código(s) da edição: C21 ou C21,CMR")
    year = django_filters.NumberFilter(field_name="release_date__year")
    colors = django_filters.CharFilter(method="filter_colors", help_text="Identidade exata: WUB, G, C (incolor)")
    search = django_filters.CharFilter(method="filter_search", help_text="Nome do deck ou de um comandante")
    active = django_filters.BooleanFilter(field_name="is_active")
    slugs = django_filters.CharFilter(method="filter_slugs", help_text="Lista de slugs separados por vírgula")

    class Meta:
        model = Deck
        fields = []

    def filter_edition(self, qs, name, value):
        codes = [c.strip().upper() for c in value.split(",") if c.strip()]
        return qs.filter(edition__code__in=codes)

    def filter_colors(self, qs, name, value):
        value = value.strip().upper()
        return qs.filter(color_identity="" if value == "C" else normalize_colors(value))

    def filter_slugs(self, qs, name, value):
        return qs.filter(slug__in=[s.strip() for s in value.split(",") if s.strip()][:500])

    def filter_search(self, qs, name, value):
        return qs.filter(
            Q(name__icontains=value)
            | Q(deck_cards__is_commander=True, deck_cards__card__name__icontains=value)
        ).distinct()
