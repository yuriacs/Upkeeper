from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    is_admin = serializers.BooleanField(source="is_staff", read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "email", "is_admin"]


class RegisterSerializer(serializers.Serializer):
    username = serializers.RegexField(
        r"^[\w.-]{3,30}$",
        error_messages={"invalid": "Use de 3 a 30 letras, números, ponto, hífen ou sublinhado."},
    )
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8, max_length=128)

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("Este nome de usuário já está em uso.")
        return value

    def validate_email(self, value):
        value = value.lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Já existe uma conta com este e-mail.")
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
