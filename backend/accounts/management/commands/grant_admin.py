from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Dá (ou tira, com --revoke) o acesso ao painel de administração de uma conta."

    def add_arguments(self, parser):
        parser.add_argument("email")
        parser.add_argument("--revoke", action="store_true")

    def handle(self, email, revoke=False, **opts):
        user = get_user_model().objects.filter(email__iexact=email).first()
        if user is None:
            raise CommandError(f"Nenhuma conta com o e-mail {email}.")
        user.is_staff = not revoke
        user.save(update_fields=["is_staff"])
        self.stdout.write(f"{user.username}: painel {'removido' if revoke else 'liberado'}.")
