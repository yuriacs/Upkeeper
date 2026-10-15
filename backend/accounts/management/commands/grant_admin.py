from django.core.management.base import BaseCommand, CommandError

from accounts.views import find_user


class Command(BaseCommand):
    help = "Dá (ou tira, com --revoke) o acesso ao painel de administração de uma conta (usuário ou e-mail)."

    def add_arguments(self, parser):
        parser.add_argument("login", help="nome de usuário ou e-mail da conta")
        parser.add_argument("--revoke", action="store_true")

    def handle(self, login, revoke=False, **opts):
        user = find_user(login)
        if user is None:
            raise CommandError(f"Nenhuma conta com o usuário ou e-mail {login}.")
        user.is_staff = not revoke
        user.save(update_fields=["is_staff"])
        self.stdout.write(f"{user.username}: painel {'removido' if revoke else 'liberado'}.")
