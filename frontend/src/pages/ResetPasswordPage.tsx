import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
  Alert, Anchor, Button, Center, Container, Loader, Paper, PasswordInput,
  Text, TextInput, Title,
} from "@mantine/core";
import { api, ApiError } from "../api/client";
import type { MessageResponse, PasswordResetPreview } from "../api/types";

// ActivatePage ile aynı üç durum: ölü linkte kullanıcı yeni şifresini
// YAZMADAN ÖNCE hatayı görmeli (K-24'ün K-43'e taşınan gerekçesi).
type PreviewState =
  | { phase: "loading" }
  | { phase: "valid"; email: string }
  | { phase: "dead"; reason: string };

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();

  const [state, setState] = useState<PreviewState>({ phase: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm({
    initialValues: { password: "", confirm: "" },
    validate: {
      password: (v) => (v.length >= 8 ? null : "Şifre en az 8 karakter olmalı"),
      confirm: (v, values) => (v === values.password ? null : "Şifreler eşleşmiyor"),
    },
  });

  // Açılış ön-doğrulaması. Token'ı TÜKETMEZ — yakan tek uç reset-password.
  useEffect(() => {
    if (!token) {
      setState({ phase: "dead", reason: "Bağlantıda sıfırlama kodu yok." });
      return;
    }
    api
      .get<PasswordResetPreview>(`/auth/reset/${token}`)
      .then((preview) => setState({ phase: "valid", email: preview.email }))
      .catch((e) => {
        const reason = e instanceof ApiError ? e.message : "Bağlantı doğrulanamadı.";
        setState({ phase: "dead", reason });
      });
  }, [token]);

  async function handleSubmit(values: typeof form.values) {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await api.post<MessageResponse>("/auth/reset-password", {
        token,
        password: values.password,
      });
      notifications.show({
        color: "green",
        message: "Şifreniz güncellendi. Şimdi giriş yapabilirsiniz.",
      });
      navigate("/login", { replace: true });
    } catch (e) {
      // GET geçerli demiş olsa bile POST başarısız olabilir: token bu arada
      // dolabilir/kullanılabilir, hesap kapatılmış olabilir (TOCTOU).
      setSubmitError(e instanceof ApiError ? e.message : "Beklenmeyen bir hata oluştu");
    } finally {
      setSubmitting(false);
    }
  }

  if (state.phase === "loading") {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  if (state.phase === "dead") {
    return (
      <Container size={420} py="xl">
        <Alert color="red" title="Sıfırlama bağlantısı geçersiz" mt="xl">
          {state.reason}
          <Text mt="sm" size="sm">
            Bağlantılar kısa süre geçerlidir ve bir kez kullanılır. Yeni bir
            bağlantı isteyebilirsiniz.
          </Text>
          <Anchor component={Link} to="/forgot-password" size="sm" mt="sm" display="block">
            Yeni bağlantı iste
          </Anchor>
        </Alert>
      </Container>
    );
  }

  // state.phase === "valid"
  return (
    <Container size={420} py="xl">
      <Title order={2} ta="center" mt="xl">
        Yeni Şifre Belirleyin
      </Title>
      <Paper withBorder shadow="sm" p="lg" radius="md" mt="lg">
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <TextInput label="E-posta" value={state.email} readOnly disabled />
          <PasswordInput label="Yeni şifre" mt="md" {...form.getInputProps("password")} />
          <PasswordInput
            label="Yeni şifre (tekrar)"
            mt="md"
            {...form.getInputProps("confirm")}
          />
          {submitError && (
            <Alert color="red" mt="md">
              {submitError}
            </Alert>
          )}
          <Button type="submit" fullWidth mt="lg" loading={submitting}>
            Şifreyi Güncelle
          </Button>
        </form>
      </Paper>
    </Container>
  );
}
