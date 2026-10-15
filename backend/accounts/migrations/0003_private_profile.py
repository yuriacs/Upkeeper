"""
Tira os e-mails legíveis do banco.

Cria o perfil privado de cada conta com a impressão digital do e-mail (HMAC com EMAIL_PEPPER) e
apaga o e-mail em texto da tabela de usuários e das contas Google/Discord. Depois disso, o e-mail
só continua funcionando para entrar e para "esqueci a senha"; a cópia legível passa a morar no
cofre do jogador (ele adiciona de novo na página da conta).
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def hide_emails(apps, schema_editor):
    from accounts.privacy import email_digest

    User = apps.get_model("auth", "User")
    PrivateProfile = apps.get_model("accounts", "PrivateProfile")
    SocialAccount = apps.get_model("accounts", "SocialAccount")
    taken = set()
    for user in User.objects.order_by("pk").iterator():
        email = user.email or next(
            (a.email for a in SocialAccount.objects.filter(user_id=user.pk).order_by("pk") if a.email), ""
        )
        digest = email_digest(email)
        if digest in taken:  # e-mail repetido (não deveria haver): fica com a conta mais antiga
            digest = None
        if digest:
            taken.add(digest)
        PrivateProfile.objects.create(user_id=user.pk, email_digest=digest)
    User.objects.update(email="", first_name="", last_name="")


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0002_social_account"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.CreateModel(
            name="PrivateProfile",
            fields=[
                (
                    "user",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        primary_key=True,
                        related_name="private",
                        serialize=False,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "email_digest",
                    models.CharField(
                        blank=True,
                        editable=False,
                        max_length=64,
                        null=True,
                        unique=True,
                    ),
                ),
                (
                    "auth_scheme",
                    models.PositiveSmallIntegerField(
                        choices=[
                            (
                                0,
                                "senha enviada ao servidor (contas antigas, até o próximo login)",
                            ),
                            (1, "chave derivada no navegador"),
                        ],
                        default=0,
                    ),
                ),
                (
                    "kdf_salt",
                    models.CharField(blank=True, editable=False, max_length=32),
                ),
                (
                    "kdf_iterations",
                    models.PositiveIntegerField(default=600000, editable=False),
                ),
                (
                    "key_by_secret",
                    models.CharField(blank=True, editable=False, max_length=128),
                ),
                (
                    "key_by_recovery",
                    models.CharField(blank=True, editable=False, max_length=128),
                ),
                ("vault", models.TextField(blank=True, editable=False)),
                (
                    "vault_version",
                    models.PositiveIntegerField(default=0, editable=False),
                ),
                (
                    "vault_updated_at",
                    models.DateTimeField(blank=True, editable=False, null=True),
                ),
            ],
            options={
                "verbose_name": "perfil privado (cifrado)",
                "verbose_name_plural": "perfis privados (cifrados)",
            },
        ),
        migrations.RunPython(hide_emails, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="socialaccount",
            name="email",
        ),
    ]
