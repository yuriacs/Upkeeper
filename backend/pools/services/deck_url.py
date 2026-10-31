"""
Importar um deck pelo link de outro site: o servidor busca a lista e devolve o texto, no mesmo
formato que a pessoa colaria (quem salva é a importação de sempre, pools/services/import_deck.py).

- Archidekt: API pública em JSON (comandante pela categoria "Commander"; maybeboard à parte).
- MTGGoldfish: o download em texto do próprio site (não marca o comandante: a prévia pede para conferir).
- Moxfield e TappedOut não deixam buscar a lista por servidor: a mensagem ensina a copiar o export.

Só endereços montados aqui a partir do id do deck (nunca o link recebido): nada de buscar URL qualquer.
"""

import json
import re
import urllib.error
import urllib.request

from django.utils.translation import gettext as _

from decks.services.http import USER_AGENT

ARCHIDEKT_RE = re.compile(r"^(?:https?://)?(?:www\.)?archidekt\.com/(?:api/)?decks/(?P<id>\d+)", re.IGNORECASE)
GOLDFISH_RE = re.compile(
    r"^(?:https?://)?(?:www\.)?mtggoldfish\.com/deck/(?:download/|visual/|arena_download/)?(?P<id>\d+)", re.IGNORECASE
)
MOXFIELD_RE = re.compile(r"^(?:https?://)?(?:www\.)?moxfield\.com/", re.IGNORECASE)
TAPPEDOUT_RE = re.compile(r"^(?:https?://)?(?:www\.)?tappedout\.net/", re.IGNORECASE)

MAX_BYTES = 3_000_000
TIMEOUT = 15
COMMANDER_CATEGORIES = {"commander", "commanders"}
MAYBE_CATEGORIES = {"maybeboard", "considering"}
SKIP_CATEGORIES = {"sideboard", "tokens", "token"}


class DeckUrlError(Exception):
    pass


def _get(url: str, accept: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            return res.read(MAX_BYTES)
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403, 404):
            raise DeckUrlError(_("Deck not found. Check the link and whether the deck is public.")) from None
        raise DeckUrlError(
            _("The site did not answer ({code}). Try again in a moment or paste the list.").format(code=exc.code)
        ) from None
    except (urllib.error.URLError, TimeoutError):
        raise DeckUrlError(_("Could not reach the site. Try again in a moment or paste the list.")) from None


def fetch_deck(url: str, *, get=_get) -> dict:
    """{"name", "decklist", "source", "warnings"} do deck no link. Levanta DeckUrlError."""
    url = (url or "").strip()
    if m := ARCHIDEKT_RE.match(url):
        return _archidekt(m.group("id"), get)
    if m := GOLDFISH_RE.match(url):
        return _goldfish(m.group("id"), get)
    if MOXFIELD_RE.match(url):
        raise DeckUrlError(
            _(
                "Moxfield does not let other sites read its decks. On Moxfield, open the deck, click "
                '"Export", copy the list and paste it in the "Paste list" tab.'
            )
        )
    if TAPPEDOUT_RE.match(url):
        raise DeckUrlError(
            _(
                "TappedOut does not let other sites read its decks. On TappedOut, open the deck, use "
                '"Export" → "Text", copy the list and paste it in the "Paste list" tab.'
            )
        )
    raise DeckUrlError(_("Link not supported. Use a deck link from Archidekt or MTGGoldfish, or paste the list."))


def _clean(text: str) -> str:
    """Sem colchetes nem quebras: o texto vai para dentro de "[Categoria]" numa linha só."""
    return re.sub(r"[\[\]\r\n]", "", text or "").strip()


def _archidekt(deck_id: str, get) -> dict:
    try:
        data = json.loads(get(f"https://archidekt.com/api/decks/{deck_id}/", "application/json"))
    except ValueError:
        raise DeckUrlError(_("The site sent something we could not read. Paste the list instead.")) from None
    # Categorias fora do deck (marcadas "não incluir no deck" no Archidekt)
    outside = {
        (c.get("name") or "").casefold() for c in data.get("categories") or [] if c.get("includedInDeck") is False
    }
    commanders, deck, maybe = [], [], []
    for entry in data.get("cards") or []:
        if entry.get("deletedAt"):
            continue
        card = entry.get("card") or {}
        name = ((card.get("oracleCard") or {}).get("name") or "").strip()
        qty = int(entry.get("quantity") or 0)
        if not name or qty <= 0:
            continue
        edition = (card.get("edition") or {}).get("editioncode") or ""
        number = card.get("collectorNumber") or ""
        line = f"{qty} {name}" + (f" ({edition.upper()}) {number}" if edition and number else "")
        cats = [_clean(c) for c in entry.get("categories") or [] if _clean(c)]
        folded = {c.casefold() for c in cats}
        if folded & COMMANDER_CATEGORIES:
            commanders.append(line)
        elif folded & MAYBE_CATEGORIES:
            maybe.append(line)
        elif folded & SKIP_CATEGORIES or (folded and folded <= outside):
            continue
        else:
            # A primeira categoria vira a função da carta no deckbuilder ("[Ramp]")
            deck.append(line + (f" [{cats[0]}]" if cats else ""))
    if not commanders and not deck:
        raise DeckUrlError(_("This deck has no cards."))
    parts = []
    if commanders:
        parts += ["Commander", *commanders, ""]
    parts += ["Deck", *deck]
    if maybe:
        parts += ["", "Maybeboard", *maybe]
    warnings = [] if commanders else [_("The deck has no \"Commander\" category: check the commander.")]
    return {"name": (data.get("name") or "")[:100], "decklist": "\n".join(parts), "source": "archidekt", "warnings": warnings}


def _goldfish(deck_id: str, get) -> dict:
    raw = get(f"https://www.mtggoldfish.com/deck/download/{deck_id}", "text/plain")
    text = raw.decode("utf-8", errors="replace").strip()
    if not text or text.lstrip().startswith("<"):
        raise DeckUrlError(_("Deck not found. Check the link and whether the deck is public."))
    return {
        "name": "",
        "decklist": text,
        "source": "mtggoldfish",
        "warnings": [_("MTGGoldfish does not mark the commander: check it in the preview.")],
    }
