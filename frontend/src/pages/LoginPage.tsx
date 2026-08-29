import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useForm } from "@mantine/form";
import {
  Alert, Anchor, Button, Container, Paper, PasswordInput, TextInput, Title,
} from "@mantine/core";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { useT } from "../i18n";

export default function LoginPage() {
  const { user, login } = useAuth();
  const t = useT();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    initialValues: { email: "", password: "" },
    validate: {
      email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : t.auth.invalidEmail),
      password: (v) => (v.length > 0 ? null : t.auth.passwordRequired),
    },
  });

  // Girişli kullanıcıya login formu gösterilmez. login() başarılı olunca da
  // user dolar ve bu satır yönlendirmeyi kendiliğinden yapar — aşağıda ayrıca
  // navigate çağrısı YOK (Çıkış butonundaki desenin aynısı).
  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(values: typeof form.values) {
    setError(null);
    setSubmitting(true);
    try {
      await login(values.email, values.password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.auth.unexpectedError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size={420} py="xl">
      <Title order={2} ta="center" mt="xl">
        {t.auth.title}
      </Title>
      <Paper withBorder shadow="sm" p="lg" radius="md" mt="lg">
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <TextInput
            label={t.auth.email}
            placeholder={t.auth.emailPlaceholder}
            autoFocus
            {...form.getInputProps("email")}
          />
          <PasswordInput label={t.auth.password} mt="md" {...form.getInputProps("password")} />
          {error && (
            <Alert color="red" mt="md">
              {error}
            </Alert>
          )}
          <Button type="submit" fullWidth mt="lg" loading={submitting}>
            {t.auth.loginButton}
          </Button>
          {/* Kayıt ol linki YOK — hesaplar yalnız davetle açılır (wireframe §1).
              Şifre sıfırlama ise hesabı olan kullanıcının kendi yolu (K-43). */}
          <Anchor component={Link} to="/forgot-password" size="sm" mt="md" display="block" ta="center">
            {t.auth.forgotPassword}
          </Anchor>
        </form>
      </Paper>
    </Container>
  );
}