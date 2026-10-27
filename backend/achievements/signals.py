"""Conquistas ganhas fora da mesa: primeiro sorteio e primeiro deck na deckpool."""

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from decks.models import Draw
from pools.models import UserDeck

from . import services


@receiver(post_save, sender=Draw)
def first_draw(sender, instance, created, raw=False, **kwargs):
    if created and not raw and instance.created_by_id:
        uid = instance.created_by_id
        transaction.on_commit(lambda: services.unlock(uid, "shuffle_up"))


@receiver(post_save, sender=UserDeck)
def first_deck(sender, instance, created, raw=False, **kwargs):
    if created and not raw and instance.owner_id:
        uid = instance.owner_id
        transaction.on_commit(lambda: services.unlock(uid, "deckbuilders_pride"))
