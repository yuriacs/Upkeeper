"""
Dá acesso ao painel de administração (is_staff) para a conta do dono do site.
Roda uma vez, no deploy. Para dar acesso a outra conta depois: `python manage.py grant_admin <email>`.

É feito por marca na conta, e não comparando o e-mail a cada acesso, porque o site não
verifica e-mails: se esta conta fosse excluída, outra pessoa poderia se cadastrar com o
mesmo endereço e ganharia acesso.
"""

from django.db import migrations

OWNER_EMAIL = "yurimaxqi@gmail.com"


def grant(apps, schema_editor):
    User = apps.get_model("auth", "User")
    User.objects.filter(email__iexact=OWNER_EMAIL).update(is_staff=True)


class Migration(migrations.Migration):
    dependencies = [("auth", "0012_alter_user_first_name_max_length")]

    operations = [migrations.RunPython(grant, migrations.RunPython.noop)]
