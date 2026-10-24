from django.test import TestCase

from tables import state
from tables.card_actions import parse

TREASURE = "https://cards.scryfall.io/normal/front/t/r/treasure.jpg"

EVOLVING_WILDS = (
    "{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, "
    "then shuffle."
)
CULTIVATE = (
    "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped "
    "and the other into your hand, then shuffle."
)


class ParseTests(TestCase):
    """O texto oficial vira atalhos só quando encaixa com certeza num modelo."""

    def test_land_search(self):
        self.assertEqual(
            parse("Evolving Wilds", "Land", EVOLVING_WILDS),
            [{"k": "search", "n": 1, "to": ["field_tapped"], "basic": True, "types": ["land"], "sac": True, "tap": True}],
        )
        self.assertEqual(
            parse("Cultivate", "Sorcery", CULTIVATE),
            [{"k": "search", "n": 2, "to": ["field_tapped", "hand"], "upto": True, "basic": True, "types": ["land"]}],
        )
        farseek = "Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle."
        self.assertEqual(parse("Farseek", "Sorcery", farseek)[0]["sub"], ["Plains", "Island", "Swamp", "Mountain"])
        fetch = "{T}, Pay 1 life, Sacrifice Flooded Strand: Search your library for a Plains or Island card, put it onto the battlefield, then shuffle."
        act = parse("Flooded Strand", "Land", fetch)[0]
        self.assertEqual((act["to"], act["life"], act["sac"]), (["field"], 1, True))

    def test_unknown_search_has_no_shortcut(self):
        text = "Search your library for a legendary creature card with mana value 3 or less, reveal it, put it into your hand, then shuffle."
        self.assertEqual(parse("X", "Sorcery", text), [])

    def test_tokens(self):
        self.assertEqual(
            parse("Hornet Queen", "Creature", "Flying, deathtouch\nWhen this creature enters, create four 1/1 green Insect creature tokens with flying and deathtouch."),
            [{"k": "tokens", "n": 4, "name": "Insect", "p": "1", "t": "1", "c": "g"}],
        )
        self.assertEqual(parse("X", "Artifact", "{T}: Create a Treasure token.")[0], {"k": "tokens", "n": 1, "name": "Treasure", "tap": True})
        avenger = parse("Avenger", "Creature", "When this creature enters, create a 0/1 green Plant creature token for each land you control.")
        self.assertEqual(avenger[0]["n"], 0)  # quantidade perguntada ao jogador

    def test_simple_effects_in_text_order(self):
        self.assertEqual(
            [a["k"] for a in parse("Preordain", "Sorcery", "Scry 2, then draw a card.")], ["scry", "draw"]
        )
        self.assertEqual(parse("Wrath of God", "Sorcery", "Destroy all creatures. They can't be regenerated."),
                         [{"k": "wipe", "to": "graveyard", "what": ["creature"]}])
        self.assertEqual(parse("X", "Enchantment", "Whenever a creature you control enters, each opponent loses 1 life and you gain 1 life."),
                         [{"k": "drain", "n": 1, "gain": 1}])
        self.assertEqual(parse("X", "Sorcery", "Each player draws two cards."), [])  # mexe na mão dos outros
        self.assertEqual(parse("Forest", "Basic Land — Forest", "({T}: Add {G}.)"), [])


def row(name, type_line, text="", qty=1):
    return {"name": name, "image": "", "quantity": qty, "is_commander": False, "type_line": type_line, "oracle_text": text}


class CardActionStateTests(TestCase):
    def setUp(self):
        self.t = state.Table(state.new_table("ACT1"))
        self.t.join(1, "a")
        self.t.join(2, "b")
        rows = [
            row("Forest", "Basic Land — Forest", "({T}: Add {G}.)", 10),
            row("Evolving Wilds", "Land", EVOLVING_WILDS),
            row("Cultivate", "Sorcery", CULTIVATE),
            row("Bear", "Creature — Bear", "", 5),
            row("Wrath of God", "Sorcery", "Destroy all creatures."),
            row("Hornet Queen", "Creature — Insect", "When this creature enters, create four 1/1 green Insect creature tokens."),
        ]
        for uid in (1, 2):
            self.t.load_deck(uid, {"kind": "precon", "ref": "x", "name": "X"}, rows)
        self.seat = self.t.seat_of(1)

    def find(self, name, seat=None):
        seat = seat or self.seat
        return next(cid for cid, c in seat["cards"].items() if c["name"] == name)

    def to(self, name, zone, seat=None):
        seat, cid = seat or self.seat, self.find(name, seat)
        z, _ = self.t._find(seat, cid)
        seat["zones"][z].remove(cid) if z != "battlefield" else None
        if zone == "battlefield":
            seat["zones"]["battlefield"].append(state._field_item(cid, 0.5, 0.5, seat["cards"][cid]))
        else:
            seat["zones"][zone].append(cid)
        return cid

    def test_fetch_land_two_steps(self):
        t = self.t
        wilds = self.to("Evolving Wilds", "battlefield")
        self.assertTrue(t.view(1)["players"][0]["battlefield"][-1]["acts"])
        seq = t.data["seq"]
        picks = t.card_action(1, wilds, 0)["pick"]
        self.assertEqual({c["name"] for c in picks}, {"Forest"})
        self.assertEqual(t.data["seq"], seq)  # escolher não muda nada
        t.card_action(1, wilds, 0, pick=[picks[0]["id"]])
        field = {self.seat["cards"][i["id"]]["name"]: i for i in self.seat["zones"]["battlefield"]}
        self.assertTrue(field["Forest"]["tapped"])
        self.assertIn(wilds, self.seat["zones"]["graveyard"])  # sacrificada
        self.assertEqual(t.data["log"][-2]["kind"], "card_action")
        with self.assertRaises(state.ActionError):
            t.card_action(1, wilds, 0)  # já não está no campo

    def test_cultivate_from_hand_goes_to_graveyard(self):
        t = self.t
        cult = self.to("Cultivate", "hand")
        forests = [c["id"] for c in t.card_action(1, cult, 0)["pick"]][:2]
        t.card_action(1, cult, 0, pick=forests)
        self.assertIn(forests[1], self.seat["zones"]["hand"])
        self.assertTrue(any(i["id"] == forests[0] and i["tapped"] for i in self.seat["zones"]["battlefield"]))
        self.assertIn(cult, self.seat["zones"]["graveyard"])

    def test_bad_pick_leaves_no_log(self):
        t = self.t
        wilds = self.to("Evolving Wilds", "battlefield")
        bear = self.find("Bear")
        seq, size = t.data["seq"], len(t.data["log"])
        with self.assertRaises(state.ActionError):
            t.card_action(1, wilds, 0, pick=[bear])
        self.assertEqual((t.data["seq"], len(t.data["log"])), (seq, size))
        self.assertTrue(any(i["id"] == wilds for i in self.seat["zones"]["battlefield"]))

    def test_tokens_and_wipe(self):
        t = self.t
        queen = self.to("Hornet Queen", "battlefield")
        t.card_action(1, queen, 0, image=TREASURE)
        insects = [i for i in self.seat["zones"]["battlefield"] if self.seat["cards"][i["id"]]["name"] == "Insect"]
        self.assertEqual(len(insects), 4)
        self.to("Bear", "battlefield", t.seat_of(2))
        wrath = self.to("Wrath of God", "hand")
        t.card_action(1, wrath, 0)
        self.assertEqual(self.seat["zones"]["battlefield"], [])
        self.assertEqual(t.seat_of(2)["zones"]["battlefield"], [])
        self.assertIn("Bear", [t.seat_of(2)["cards"][c]["name"] for c in t.seat_of(2)["zones"]["graveyard"]])
        with self.assertRaises(state.ActionError):
            t.card_action(2, queen, 0, image=TREASURE)  # carta de outro jogador

    def test_spell_on_battlefield_tapped_and_stolen(self):
        """Casos da mesa manual: mágica arrastada para o campo, carta já virada e carta de outro que você controla."""
        t = self.t
        cult = self.to("Cultivate", "battlefield")  # "conjurou" arrastando para o campo
        forests = [c["id"] for c in t.card_action(1, cult, 0)["pick"]][:2]
        t.card_action(1, cult, 0, pick=forests)
        self.assertIn(cult, self.seat["zones"]["graveyard"])

        wilds = self.to("Evolving Wilds", "battlefield")
        next(i for i in self.seat["zones"]["battlefield"] if i["id"] == wilds)["tapped"] = True  # virou antes
        pick = t.card_action(1, wilds, 0)["pick"][0]["id"]
        t.card_action(1, wilds, 0, pick=[pick])
        self.assertIn(wilds, self.seat["zones"]["graveyard"])

        other = t.seat_of(2)
        queen = self.to("Hornet Queen", "battlefield", other)
        next(i for i in other["zones"]["battlefield"] if i["id"] == queen)["controller"] = 1
        t.card_action(1, queen, 0, image=TREASURE)
        self.assertEqual(sum(1 for c in self.seat["cards"].values() if c["name"] == "Insect"), 4)
        with self.assertRaises(state.ActionError):
            t.card_action(2, queen, 0, image=TREASURE)  # o dono não controla mais


class TargetedParseTests(TestCase):
    """Efeitos num alvo, cemitério, olhar o topo, entra virada e gatilhos."""

    def test_targets(self):
        self.assertEqual(parse("Murder", "Instant", "Destroy target creature."),
                         [{"k": "target", "do": "destroy", "what": ["creature"]}])
        self.assertEqual(parse("Doom Blade", "Instant", "Destroy target nonblack creature.")[0]["what"], ["creature"])
        self.assertEqual(parse("Putrefy", "Instant", "Destroy target artifact or creature. It can't be regenerated.")[0]["what"],
                         ["artifact", "creature"])
        self.assertEqual(parse("X", "Instant", "Exile target nonland permanent.")[0]["what"], ["nonland"])
        self.assertEqual(parse("X", "Instant", "Exile target creature an opponent controls.")[0]["ctl"], "opp")
        self.assertEqual(parse("Unsummon", "Instant", "Return target creature to its owner's hand.")[0]["do"], "bounce")
        self.assertEqual(parse("X", "Creature", "{T}: Untap target land.")[0], {"k": "target", "do": "untap", "what": ["land"], "tap": True})
        self.assertEqual(parse("X", "Instant", "Put two +1/+1 counters on target creature you control.")[0],
                         {"k": "target", "do": "counters", "what": ["creature"], "n": 2, "c": "+1/+1", "ctl": "you"})
        # Restrições que mudam o efeito, ou mais de um alvo: sem atalho
        self.assertEqual(parse("X", "Instant", "Destroy target creature with flying."), [])
        self.assertEqual(parse("X", "Instant", "Destroy target artifact and target enchantment."), [])
        # Sai e volta (blink) não é exilar; habilidade entre aspas é da ficha, não da carta
        self.assertEqual(parse("X", "Instant", "Exile target nonland permanent. Return it to the battlefield tapped under its owner's control."), [])
        self.assertEqual(
            [a["k"] for a in parse("X", "Sorcery", 'Create a 1/1 red Devil creature token with "When this token dies, it deals 1 damage to any target."')],
            ["tokens"],
        )
        self.assertEqual(parse("X", "Creature", "When this creature enters, it deals 1 damage to target opponent for each creature card in your graveyard.")[0],
                         {"k": "damage", "n": 0})

    def test_modes_spend_the_spell(self):
        acts = parse("Hull Breach", "Sorcery", "Choose one —\n• Destroy target artifact.\n• Destroy target enchantment.\n"
                     "• Destroy target artifact and target enchantment.")
        self.assertEqual([(a["what"], a["mode"]) for a in acts], [(["artifact"], True), (["enchantment"], True)])

    def test_damage(self):
        self.assertEqual(parse("Lightning Bolt", "Instant", "Lightning Bolt deals 3 damage to any target."), [{"k": "damage", "n": 3}])
        self.assertEqual(parse("Guttersnipe", "Creature", "Whenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent."),
                         [{"k": "drain", "n": 2}])
        self.assertEqual(parse("X", "Instant", "X deals X damage to any target.")[0], {"k": "damage", "n": 0})

    def test_graveyard_look_investigate_draw(self):
        self.assertEqual(parse("Eternal Witness", "Creature", "When this creature enters, return target card from your graveyard to your hand."),
                         [{"k": "regrow", "n": 1, "to": "hand"}])
        self.assertEqual(parse("X", "Sorcery", "Return up to two target creature cards from your graveyard to your hand.")[0],
                         {"k": "regrow", "n": 2, "to": "hand", "types": ["creature"], "upto": True})
        self.assertEqual(parse("X", "Sorcery", "Return target creature card with mana value 3 or less from your graveyard to the battlefield."), [])
        impulse = "Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order."
        self.assertEqual(parse("Impulse", "Instant", impulse)[0], {"k": "look", "n": 4})
        self.assertEqual(parse("X", "Creature", "Whenever a land you control enters, investigate.")[0], {"k": "tokens", "n": 1, "name": "Clue"})
        self.assertEqual(parse("Sign in Blood", "Sorcery", "Target player draws two cards and loses 2 life."), [{"k": "draw", "n": 2}])

    def test_enters_tapped_and_triggers(self):
        from tables.card_actions import enters_tapped, triggers

        self.assertTrue(enters_tapped("Dismal Backwater", "This land enters tapped.\nWhen this land enters, you gain 1 life."))
        self.assertTrue(enters_tapped("Old Land", "Old Land enters the battlefield tapped."))
        self.assertFalse(enters_tapped("Sunken Hollow", "This land enters tapped unless you control two or more basic lands."))
        text = ("Flying\nAt the beginning of your upkeep, you may draw a card.\n"
                "Raid — At the beginning of your end step, if you attacked this turn, create a Treasure token.")
        self.assertEqual(
            triggers(text),
            [{"w": "upkeep", "who": "you", "text": "At the beginning of your upkeep, you may draw a card."},
             {"w": "end", "who": "you", "text": "At the beginning of your end step, if you attacked this turn, create a Treasure token."}],
        )
        self.assertEqual(triggers("At the beginning of each combat, goad target creature.")[0]["who"], "each")
        self.assertEqual(triggers("At the beginning of each opponent's upkeep, that player loses 1 life.")[0]["who"], "opp")


class TargetedStateTests(TestCase):
    def setUp(self):
        self.t = state.Table(state.new_table("ACT2"))
        self.t.join(1, "a")
        self.t.join(2, "b")
        rows = [
            row("Forest", "Basic Land — Forest", "({T}: Add {G}.)", 5),
            row("Murder", "Instant", "Destroy target creature."),
            row("Hull Breach", "Sorcery", "Choose one —\n• Destroy target artifact.\n• Destroy target enchantment."),
            row("Lightning Bolt", "Instant", "Lightning Bolt deals 3 damage to any target."),
            row("Eternal Witness", "Creature — Human Shaman", "When this creature enters, return target card from your graveyard to your hand."),
            row("Bear", "Creature — Bear", "", 3),
            row("Ring", "Artifact", "{T}: Add {C}{C}."),
            row("Tapland", "Land", "This land enters tapped.\n{T}: Add {G}."),
            row("Phyrexian Arena", "Enchantment", "At the beginning of your upkeep, you draw a card and you lose 1 life."),
            row("Swords", "Instant", "Exile target creature an opponent controls."),
        ]
        for uid in (1, 2):
            self.t.load_deck(uid, {"kind": "precon", "ref": "x", "name": "X"}, rows)
        self.seat, self.other = self.t.seat_of(1), self.t.seat_of(2)

    find = CardActionStateTests.find
    to = CardActionStateTests.to

    def test_destroy_target_from_hand(self):
        t = self.t
        murder = self.to("Murder", "hand")
        bear = self.to("Bear", "battlefield", self.other)
        ring = self.to("Ring", "battlefield", self.other)
        with self.assertRaises(state.ActionError):
            t.card_action(1, murder, 0)  # sem alvo
        with self.assertRaises(state.ActionError):
            t.card_action(1, murder, 0, target=ring)  # artefato não é criatura
        t.card_action(1, murder, 0, target=bear)
        self.assertIn(bear, self.other["zones"]["graveyard"])
        self.assertIn(murder, self.seat["zones"]["graveyard"])
        self.assertEqual(next(e for e in t.data["log"] if e["kind"] == "card_action")["to"], "Bear")

    def test_opponent_only_target(self):
        t = self.t
        swords = self.to("Swords", "hand")
        mine = self.to("Bear", "battlefield")
        with self.assertRaises(state.ActionError):
            t.card_action(1, swords, 0, target=mine)
        theirs = self.to("Bear", "battlefield", self.other)
        t.card_action(1, swords, 0, target=theirs)
        self.assertIn(theirs, self.other["zones"]["exile"])

    def test_mode_sends_spell_to_graveyard(self):
        t = self.t
        breach = self.to("Hull Breach", "hand")
        ring = self.to("Ring", "battlefield", self.other)
        t.card_action(1, breach, 0, target=ring)  # primeiro de dois modos
        self.assertIn(breach, self.seat["zones"]["graveyard"])

    def test_damage_to_player(self):
        t = self.t
        bolt = self.to("Lightning Bolt", "hand")
        with self.assertRaises(state.ActionError):
            t.card_action(1, bolt, 0, player=99)
        t.card_action(1, bolt, 0, player=2)
        self.assertEqual(self.other["life"], state.STARTING_LIFE - 3)

    def test_regrow_two_steps(self):
        t = self.t
        murder = self.to("Murder", "graveyard")
        witness = self.to("Eternal Witness", "battlefield")
        picks = t.card_action(1, witness, 0)["pick"]
        self.assertEqual([c["id"] for c in picks], [murder])
        t.card_action(1, witness, 0, pick=[murder])
        self.assertIn(murder, self.seat["zones"]["hand"])
        self.assertTrue(any(i["id"] == witness for i in self.seat["zones"]["battlefield"]))  # continua no campo

    def test_enters_tapped_and_triggers_in_view(self):
        t = self.t
        land = self.to("Tapland", "hand")
        t.move(1, land, "battlefield", 0.5, 0.5)
        item = next(i for i in self.seat["zones"]["battlefield"] if i["id"] == land)
        self.assertTrue(item["tapped"])
        self.assertEqual(self.seat["mana"], {})  # entrar virada não gera mana
        arena = self.to("Phyrexian Arena", "battlefield")
        field = {c["id"]: c for p in t.view(1)["players"] for c in p["battlefield"]}
        self.assertEqual(field[arena]["trig"][0]["w"], "upkeep")
