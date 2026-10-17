from rest_framework import serializers

from .models import Card, Deck, DeckCard, Draw, DrawEntry, Edition
from .services.draw import COLOR_RULES, COLORS_ANY
from django.utils.translation import gettext as _

# Ordem de exibição das seções na decklist (terrenos por último, como no Moxfield/Archidekt)
DISPLAY_ORDER = [
    Card.Category.CREATURE,
    Card.Category.PLANESWALKER,
    Card.Category.BATTLE,
    Card.Category.ARTIFACT,
    Card.Category.ENCHANTMENT,
    Card.Category.INSTANT,
    Card.Category.SORCERY,
    Card.Category.LAND,
    Card.Category.OTHER,
]


class EditionSerializer(serializers.ModelSerializer):
    deck_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Edition
        fields = ["code", "name", "release_date", "icon_svg_uri", "deck_count"]


class EditionMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model = Edition
        fields = ["code", "name", "icon_svg_uri"]


class CardSerializer(serializers.ModelSerializer):
    class Meta:
        model = Card
        fields = [
            "scryfall_id", "oracle_id", "name", "mana_cost", "cmc", "type_line", "oracle_text",
            "colors", "color_identity", "category", "rarity", "layout", "set_code", "collector_number",
            "image_normal", "image_small", "image_art_crop", "image_back", "price_usd",
        ]


class CommanderMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model = Card
        fields = ["name", "mana_cost", "image_normal", "image_art_crop"]


class DeckListSerializer(serializers.ModelSerializer):
    edition = EditionMiniSerializer()
    face_commander = CommanderMiniSerializer()
    kind = serializers.SerializerMethodField()
    owner = serializers.SerializerMethodField()

    class Meta:
        model = Deck
        fields = [
            "slug", "name", "edition", "release_date", "color_identity", "face_commander", "is_active",
            "kind", "owner", "bracket", "power", "price_usd", "price_eur",
        ]

    def get_kind(self, deck):
        return "precon"

    def get_owner(self, deck):
        return None


class DeckCardSerializer(serializers.ModelSerializer):
    card = CardSerializer()

    class Meta:
        model = DeckCard
        fields = ["quantity", "card"]


def price_detail(deck, deck_cards) -> dict:
    """Valor estimado na página do deck: total, cópias sem preço e as cartas mais caras."""
    from .services.prices import deck_price

    price = deck_price(deck_cards)
    return {
        **price,
        "usd": str(price["usd"]),
        "eur": str(price["eur"]),
        "top": [{**t, "usd": str(t["usd"]) if t["usd"] is not None else None,
                 "eur": str(t["eur"]) if t["eur"] is not None else None} for t in price["top"]],
        "updated_at": deck.price_at.isoformat() if deck.price_at else None,
    }


def build_sections(deck_cards) -> list[dict]:
    """Agrupa cartas (objetos com .card, .quantity, .is_commander) por categoria, na ordem de exibição."""
    labels = dict(Card.Category.choices)
    groups: dict[str, list] = {}
    for dc in deck_cards:
        if not dc.is_commander:
            groups.setdefault(dc.card.category, []).append(dc)
    sections = []
    for key in DISPLAY_ORDER:
        items = sorted(groups.get(key, []), key=lambda dc: (dc.card.cmc, dc.card.name))
        if items:
            sections.append({
                "key": key,
                "label": str(labels[key]),
                "count": sum(dc.quantity for dc in items),
                "cards": DeckCardSerializer(items, many=True).data,
            })
    return sections


class DeckDetailSerializer(DeckListSerializer):
    commanders = serializers.SerializerMethodField()
    sections = serializers.SerializerMethodField()
    card_count = serializers.SerializerMethodField()

    record = serializers.SerializerMethodField()

    class Meta(DeckListSerializer.Meta):
        fields = DeckListSerializer.Meta.fields + [
            "source_url", "card_count", "commanders", "sections", "record", "bracket_details", "analysis", "price",
        ]

    analysis = serializers.SerializerMethodField()
    price = serializers.SerializerMethodField()

    def get_price(self, deck):
        return price_detail(deck, self._deck_cards(deck))

    def get_analysis(self, deck):
        from .services.analysis import analyze

        return analyze(self._deck_cards(deck), deck.bracket, deck.bracket_details)

    def get_record(self, deck):
        """Partidas e vitórias deste precon nos sorteios com resultado."""
        from .services.stats import deck_record

        return deck_record(deck)

    # deck_cards já vem com prefetch (ver DeckViewSet.get_queryset) — nada aqui faz query nova
    def _deck_cards(self, deck):
        return list(deck.deck_cards.all())

    def get_commanders(self, deck):
        return DeckCardSerializer([dc for dc in self._deck_cards(deck) if dc.is_commander], many=True).data

    def get_card_count(self, deck):
        return sum(dc.quantity for dc in self._deck_cards(deck))

    def get_sections(self, deck):
        return build_sections(self._deck_cards(deck))


class DrawResultSerializer(serializers.Serializer):
    winner = serializers.IntegerField(allow_null=True, min_value=0)


class DrawFiltersSerializer(serializers.Serializer):
    editions = serializers.ListField(child=serializers.CharField(max_length=10), required=False, max_length=50)
    year_from = serializers.IntegerField(required=False, min_value=1993)
    year_to = serializers.IntegerField(required=False, min_value=1993)
    color_rule = serializers.ChoiceField(choices=COLOR_RULES, required=False, default=COLORS_ANY)
    same_edition = serializers.BooleanField(required=False, default=False)
    no_repeat = serializers.BooleanField(
        required=False, default=False, help_text="Ninguém recebe um deck que já recebeu antes"
    )
    max_bracket = serializers.IntegerField(
        required=False, allow_null=True, min_value=2, max_value=4, help_text="Só decks até este bracket estimado"
    )
    bracket_balance = serializers.BooleanField(
        required=False, default=False, help_text="Decks da mesa no máximo 1 bracket de diferença entre si"
    )
    deck_slugs = serializers.ListField(
        child=serializers.SlugField(max_length=220), required=False, max_length=500,
        help_text="Sortear só entre estes decks (ex.: os que o grupo tem)",
    )


class DrawRequestSerializer(serializers.Serializer):
    """
    Aceita {"players": 3} ou {"names": ["Ana", "Beto", "Caio"]} (ou os dois, se baterem).
    No modo "pool", names são os nomes de usuário dos jogadores.
    """

    mode = serializers.ChoiceField(choices=Draw.Mode.choices, required=False, default=Draw.Mode.PRECON)
    players = serializers.IntegerField(min_value=2, max_value=4, required=False)
    names = serializers.ListField(
        child=serializers.CharField(max_length=40, allow_blank=True, trim_whitespace=True),
        min_length=2, max_length=4, required=False,
    )
    filters = DrawFiltersSerializer(required=False, default=dict)

    def validate(self, data):
        names = data.get("names")
        players = data.get("players")
        if names is None and players is None:
            raise serializers.ValidationError(_("Send players or names."))
        if names is not None and players is not None and len(names) != players:
            raise serializers.ValidationError(_("The number of names does not match players."))
        if data.get("mode") == Draw.Mode.POOL and (not names or any(not n for n in names)):
            raise serializers.ValidationError(_("In a deck pool deal, give each player's username."))
        names = names or [""] * players
        names = [n or _("Player {n}").format(n=i + 1) for i, n in enumerate(names)]
        if len({n.casefold() for n in names}) != len(names):
            raise serializers.ValidationError(_("Two players have the same name."))
        data["names"] = names
        return data


class DrawEntrySerializer(serializers.ModelSerializer):
    deck = serializers.SerializerMethodField()
    owner = serializers.CharField(source="owner.username", read_only=True, default=None)

    class Meta:
        model = DrawEntry
        fields = ["position", "player_name", "deck", "owner", "rerolled_from"]

    def get_deck(self, entry):
        if entry.deck_id:
            return DeckListSerializer(entry.deck).data
        if entry.user_deck_id:
            from pools.serializers import UserDeckSummarySerializer

            return UserDeckSummarySerializer(entry.user_deck).data
        return None  # deck do usuário apagado depois do sorteio


class DrawSerializer(serializers.ModelSerializer):
    entries = DrawEntrySerializer(many=True)
    players = serializers.SerializerMethodField()

    class Meta:
        model = Draw
        fields = [
            "code", "mode", "created_at", "players", "pool_size", "filters", "entries",
            "winner_position", "result_at", "can_set_result",
        ]

    can_set_result = serializers.SerializerMethodField()

    def get_players(self, draw):
        return len(draw.entries.all())

    def get_can_set_result(self, draw):
        request = self.context.get("request")
        if request is None:
            return False
        from .permissions import can_set_result

        return can_set_result(request, draw)


class MyDrawSerializer(serializers.ModelSerializer):
    """Uma linha de "Meus sorteios": o deck que o jogador recebeu, quem mais estava na mesa e o resultado."""

    code = serializers.CharField(source="draw.code")
    mode = serializers.CharField(source="draw.mode")
    created_at = serializers.DateTimeField(source="draw.created_at")
    deck = serializers.SerializerMethodField()
    result = serializers.SerializerMethodField()
    winner = serializers.SerializerMethodField()
    opponents = serializers.SerializerMethodField()

    class Meta:
        model = DrawEntry
        fields = ["code", "mode", "created_at", "position", "player_name", "deck", "result", "winner", "opponents"]

    def get_deck(self, entry):
        return DrawEntrySerializer().get_deck(entry)

    def get_result(self, entry):
        winner = entry.draw.winner_position
        if winner is None:
            return None
        return "won" if winner == entry.position else "lost"

    def get_winner(self, entry):
        winner = entry.draw.winner_position
        return next((e.player_name for e in entry.draw.entries.all() if e.position == winner), None)

    def get_opponents(self, entry):
        return DrawEntrySerializer([e for e in entry.draw.entries.all() if e.pk != entry.pk], many=True).data
