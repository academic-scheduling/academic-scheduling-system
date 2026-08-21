import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "@mantine/form";
import {
  Alert, Anchor, Button, Container, Paper, Text, TextInput, Title,
} from "@mantine/core";
import { api, ApiError } from "../api/client";
import type { MessageResponse } from "../api/types";
import Recaptcha, { captchaEnabled } from "../auth/Recaptcha";
import { useT } from "../i18n";

/**
 * Şifremi unuttum — sıfırlama linki talebi (K-43, kontrat §1).
 *
 * Ekranın kritik davranışı: gönderim sonrası HER ZAMAN aynı nötr mesaj
 * gösterilir. "Bu e-posta kayıtlı değil" demek, sisteme kimlerin kayıtlı
 * olduğunu dışarıdan sorgulanabilir hale getirirdi (hesap sayımı).
 * Sunucu da zaten ayrım yapmıyor; UI onunla tutarlı kalır.
 */
export default function ForgotPasswordPage() {
  const t = useT();
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // K-44: CAPTCHA kapalıyken null kalır ve gönderime hiç karışmaz.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const form = useForm({
    initialValues: { email: "" },
    validate: {
      email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : t.auth.invalidEmail),
    },
  });

  async function handleSubmit(values: typeof form.values) {
    setError(null);
    setSubmitting(true);
    try {
      await api.post<MessageResponse>("/auth/forgot-password", {
        email: values.email,
        // Kapalıyken alan hiç gönderilmez; backend de beklemez (K-44).
        ...(captchaEnabled() ? { captcha_token: captchaToken } : {}),
      });
      setSent(true);
    } catch (e) {
      // Sunucu bu uçta e-posta bilinmese bile 200 döner; buraya ancak
      // gerçek bir arıza (ağ/500) veya CAPTCHA reddi (400) düşer.
      setError(e instanceof ApiError ? e.message : t.auth.unexpectedError);
      // Kullanılan/başarısız token bir daha geçerli değil: kullanıcı kutuyu
      // yeniden işaretlemeli, yoksa aynı ölü token'la tekrar 400 alır.
      setCaptchaToken(null);
      window.grecaptcha?.reset();
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <Container size={420} py="xl">
        <Title order={2} ta="center" mt="xl">
          {t.auth.sentTitle}
        </Title>
        <Paper withBorder shadow="sm" p="lg" radius="md" mt="lg">
          <Alert color="green">
            {t.auth.sentAlert}
            <Text mt="sm" size="sm">
              {t.auth.sentDetail}
            </Text>
          </Alert>
          <Anchor component={Link} to="/login" size="sm" mt="md" display="block">
            {t.auth.backToLogin}
          </Anchor>
        </Paper>
      </Container>
    );
  }

  return (
    <Container size={420} py="xl">
      <Title order={2} ta="center" mt="xl">
        {t.auth.forgotTitle}
      </Title>
      <Text c="dimmed" size="sm" ta="center" mt="sm">
        {t.auth.forgotHelp}
      </Text>
      <Paper withBorder shadow="sm" p="lg" radius="md" mt="lg">
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <TextInput
            label={t.auth.email}
            placeholder={t.auth.emailPlaceholder}
            {...form.getInputProps("email")}
          />
          <Recaptcha onChange={setCaptchaToken} />
          {error && (
            <Alert color="red" mt="md">
              {error}
            </Alert>
          )}
          {/* CAPTCHA açıkken kutu işaretlenmeden gönderim kapalı. Bu bir
              güvenlik önlemi DEĞİL (otorite sunucuda) — boşuna istek atıp
              400 yemesini engelleyen bir kolaylık. */}
          <Button
            type="submit"
            fullWidth
            mt="lg"
            loading={submitting}
            disabled={captchaEnabled() && !captchaToken}
          >
            {t.auth.forgotSubmit}
          </Button>
          <Anchor component={Link} to="/login" size="sm" mt="md" display="block">
            {t.auth.backToLogin}
          </Anchor>
        </form>
      </Paper>
    </Container>
  );
}
