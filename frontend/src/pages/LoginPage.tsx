import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useForm } from "@mantine/form";
import { Alert, Button, Container, Paper, PasswordInput, TextInput, Title } from "@mantine/core";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";

export default function LoginPage() {
  const { user, login } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    initialValues: { email: "", password: "" },
    validate: {
      email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : "Geçerli bir e-posta adresi girin"),
      password: (v) => (v.length > 0 ? null : "Şifre boş olamaz"),
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
      setError(e instanceof ApiError ? e.message : "Beklenmeyen bir hata oluştu");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size={420} py="xl">
      <Title order={2} ta="center" mt="xl">
        Akademik Program Yönetimi
      </Title>
      <Paper withBorder shadow="sm" p="lg" radius="md" mt="lg">
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <TextInput
            label="E-posta"
            placeholder="ad@muh.example.edu.tr"
            autoFocus
            {...form.getInputProps("email")}
          />
          <PasswordInput label="Şifre" mt="md" {...form.getInputProps("password")} />
          {error && (
            <Alert color="red" mt="md">
              {error}
            </Alert>
          )}
          <Button type="submit" fullWidth mt="lg" loading={submitting}>
            Giriş
          </Button>
        </form>
      </Paper>
    </Container>
  );
}