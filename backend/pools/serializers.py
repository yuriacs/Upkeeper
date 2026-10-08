from rest_framework import serializers

from decks.serializers import CommanderMiniSerializer, DeckCardSerializer, build_sections

from .models import UserDeck


class UserDeckSummarySerializer(serializers.ModelSerializer):
    """Mesmo formato do resumo de precon, para o frontend tratar os dois igual."""

    slug = serializers.SerializerMethodField()
    edition = serializers.SerializerMethodField()
    release_date = serializers.SerializerMethodField()
    is_active = serializers.SerializerMethodField()
    kind = serializers.SerializerMethodField()
    owner = serializers.CharField(source="owner.username", read_only=True)
    face_commander = CommanderMiniSerializer()

    class Meta:
        model = UserDeck
        fields = [
            "slug", "name", "edition", "release_date", "color_identity", "face_commander", "is_active",
            "kind", "owner",
        ]

    def get_slug(self, deck):
        return str(deck.pk)

    def get_edition(self, deck):
        return None

    def get_release_date(self, deck):
        return None

    def get_is_active(self, deck):
        return True

    def get_kind(self, deck):
        return "user"


class UserDeckDetailSerializer(UserDeckSummarySerializer):
    source_url = serializers.SerializerMethodField()
    card_count = serializers.SerializerMethodField()
    commanders = serializers.SerializerMethodField()
    sections = serializers.SerializerMethodField()

    class Meta(UserDeckSummarySerializer.Meta):
        fields = UserDeckSummarySerializer.Meta.fields + [
            "source_url", "card_count", "commanders", "sections", "decklist_text", "updated_at",
        ]

    def _deck_cards(self, deck):
        return list(deck.deck_cards.all())

    def get_source_url(self, deck):
        return ""

    def get_card_count(self, deck):
        return sum(dc.quantity for dc in self._deck_cards(deck))

    def get_commanders(self, deck):
        return DeckCardSerializer([dc for dc in self._deck_cards(deck) if dc.is_commander], many=True).data

    def get_sections(self, deck):
        return build_sections(self._deck_cards(deck))


class UserDeckWriteSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    decklist = serializers.CharField(max_length=20000)
    commanders = serializers.ListField(child=serializers.CharField(max_length=200), required=False, max_length=2)


class SlugListSerializer(serializers.Serializer):
    slugs = serializers.ListField(child=serializers.SlugField(max_length=220), max_length=500)
