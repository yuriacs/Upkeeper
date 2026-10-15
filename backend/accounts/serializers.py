from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from django.utils.translation import gettext as _

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    is_admin = serializers.BooleanField(source="is_staff", read_only=True)
    # Conta criada pelo Google/Discord não tem senha (exclusão confirma com o nome de usuário)
    has_password = serializers.SerializerMethodField()
    # Serviços ligados para entrar: ["google", "discord"]
    social = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "is_admin", "has_password", "social"]

    def get_has_password(self, user) -> bool:
        return user.has_usable_password()

    def get_social(self, user) -> list[str]:
        return sorted(user.social_accounts.values_list("provider", flat=True))


class RegisterSerializer(serializers.Serializer):
    username = serializers.RegexField(
        r"^[\w.-]{3,30}$",
        error_messages={"invalid": _("Use 3 to 30 letters, numbers, dots, hyphens or underscores.")},
    )
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8, max_length=128)

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError(_("This username is already taken."))
        return value

    def validate_email(self, value):
        value = value.lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError(_("There is already an account with this email."))
        return value

    def validate(self, data):
        try:
            validate_password(data["password"], User(username=data["username"], email=data["email"]))
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)})
        return data

    def create(self, data):
        return User.objects.create_user(username=data["username"], email=data["email"], password=data["password"])


class LoginSerializer(serializers.Serializer):
    login = serializers.CharField(help_text="Nome de usuário ou e-mail")
    password = serializers.CharField(write_only=True)


class PasswordConfirmSerializer(serializers.Serializer):
    password = serializers.CharField(write_only=True)
