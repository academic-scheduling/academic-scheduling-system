import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
  Alert, Button, Center, Container, Loader, Paper, PasswordInput,
  Text, TextInput, Title,
} from "@mantine/core";
import { api, ApiError } from "../api/client";
import type { InvitationPreview, MessageResponse } from "../api/types";
import { useT } from "../i18n";

// Ekranın üç durumu: sunucuya sorulan her şeyde çıkan desen.
type PreviewState =
  | { phase: "loading" }
  | { phase: "valid"; email: string; name: string }
  | { phase: "dead"; reason: string };

export default function ActivatePage() {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();

  const [state, setState] = useState<PreviewState>({ phase: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm({
    initialValues: { password: "", confirm: "" },
    validate: {
      password: (v) => (v.length >= 8 ? null : t.auth.passwordTooShort(8)),
      confirm: (v, values) => (v === values.password ? null : t.auth.passwordsDoNotMatch),
    },
  });

  // Açılış ön-doğrulaması (K-24). Token'ı TÜKETMEZ — sadece sorar.
  useEffect(() => {
    if (!token) {
      setState({ phase: "dead", reason: t.auth.noInviteCode });
      return;
    }
    api
      .get<InvitationPreview>(`/auth/invitation/${token}`)
      .then((preview) => setState({ phase: "valid", ...preview }))
      .catch((e) => {
        const reason = e instanceof ApiError ? e.message : t.auth.inviteUnverified;
        setState({ phase: "dead", reason });
      });
  }, [token]);

  async function handleSubmit(values: typeof form.values) {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await api.post<MessageResponse>("/auth/complete-invitation", {
        token,
        password: values.password,
      });
      notifications.show({
        color: "green",
        message: t.auth.activateDone,
      });
      navigate("/login", { replace: true });
    } catch (e) {
      // POST, GET geçerli dese bile başarısız olabilir: token bu arada
      // dolabilir/kullanılabilir (K-24 TOCTOU). O yüzden hata burada da ele alınır.
      setSubmitError(e instanceof ApiError ? e.message : t.auth.unexpectedError);
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
        <Alert color="red" title={t.auth.inviteLinkDeadTitle} mt="xl">
          {state.reason}
          <Text mt="sm" size="sm">
            {t.auth.inviteLinkDeadDetail}
          </Text>
        </Alert>
      </Container>
    );
  }

  // state.phase === "valid"
  return (
    <Container size={420} py="xl">
      <Title order={2} ta="center" mt="xl">
        {t.auth.activateTitle}
      </Title>
      <Paper withBorder shadow="sm" p="lg" radius="md" mt="lg">
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <TextInput label={t.auth.email} value={state.email} readOnly disabled />
          <PasswordInput label={t.auth.password} mt="md" {...form.getInputProps("password")} />
          <PasswordInput
            label={t.auth.passwordAgain}
            mt="md"
            {...form.getInputProps("confirm")}
          />
          {submitError && (
            <Alert color="red" mt="md">
              {submitError}
            </Alert>
          )}
          <Button type="submit" fullWidth mt="lg" loading={submitting}>
            {t.auth.activateSubmit}
          </Button>
        </form>
      </Paper>
    </Container>
  );
}