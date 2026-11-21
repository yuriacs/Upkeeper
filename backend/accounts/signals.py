"""
Rede de segurança: nenhum dado pessoal legível fica na tabela de usuários do Django.

O modelo de usuário do Django tem e-mail, nome e sobrenome. O site não usa nome/sobrenome, e o
e-mail vira impressão digital (accounts/privacy.py). Quem gravar um usuário com e-mail (o
createsuperuser, um teste, um código novo) tem o e-mail trocado pela impressão digital antes de
chegar ao banco.
"""

from django.conf import settings
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver
from rest_framework.authtoken.models import Token

from .privacy import email_digest


@receiver(pre_save, sender=settings.AUTH_USER_MODEL)
def strip_personal_fields(sender, instance, **kwargs):
    if instance.email:
        instance._pending_email_digest = email_digest(instance.email)
        instance.email = ""
    instance.first_name = ""
    instance.last_name = ""


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def ensure_private_profile(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    from .models import PrivateProfile

    digest = getattr(instance, "_pending_email_digest", None)
    if not created and not digest:
        return  # nada novo (ex.: só o último acesso mudou)
    profile, _ = PrivateProfile.objects.get_or_create(user=instance)
    if digest and profile.email_digest != digest:
        profile.email_digest = digest
        profile.save(update_fields=["email_digest"])
    instance._pending_email_digest = None


# ---- caches na memória (login por token e lista de amigos) ---------------------------------------


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
@receiver(post_delete, sender=settings.AUTH_USER_MODEL)
def forget_cached_user(sender, instance, **kwargs):
    """Conta gravada (senha, suspensão, nome) ou apagada: relê o login e as listas de amigos."""
    from . import auth, friends

    auth.forget_user(instance.pk)
    friends.forget_rows()  # o nome aparece na lista dos amigos dela


@receiver(post_delete, sender=Token)
def forget_cached_token(sender, instance, **kwargs):
    from . import auth

    auth.forget_token(instance.key)


@receiver(post_save, sender="accounts.Friendship")
@receiver(post_delete, sender="accounts.Friendship")
def forget_cached_friends(sender, instance, **kwargs):
    from django.db import transaction

    from . import friends

    ids = (instance.from_user_id, instance.to_user_id)
    friends.forget_rows(*ids)
    transaction.on_commit(lambda: friends.forget_rows(*ids))  # uma leitura no meio da gravação não fica
