import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Alert, Container, Group, Loader, Paper, SimpleGrid, Text, Title } from "@mantine/core";
import { api, ApiError } from "../api/client";
import type { DashboardSummary } from "../api/types";

/** Tek sayaç kartı: büyük sayı üstte, ne olduğu altında.
 *
 *  `value` sayı değil düğüm alır — çakışma kartı tek sayı değil, iki renkli
 *  sayı gösteriyor ("3 / 7"). Kart tipini ikiye bölmek yerine tek bileşen
 *  ikisini de taşıyor.
 */
function StatCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Paper withBorder radius="md" p="lg" ta="center">
      {/* component="div": `value` bazen Group taşıyor (çakışma kartı). Text
          varsayılan <p> üretir ve <p> içine <div> koymak geçersiz HTML'dir —
          tarayıcı p'yi erkenden kapatıp hizalamayı bozar. */}
      <Text component="div" fw={700} fz={36} lh={1.1}>{value}</Text>
      <Text size="sm" c="dimmed" mt={6}>{label}</Text>
    </Paper>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<DashboardSummary>("/dashboard/summary")
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Özet yüklenemedi"));
  }, []);

  if (error) return <Alert color="red" mt="md">{error}</Alert>;
  if (!data) return <Loader mt="xl" />;

  return (
    // Container sayfayı sınırlar ve ortalar: geniş ekranda kartlar tüm
    // genişliğe yayılmasın. Alttaki bloklar (çakışma tablosu, kullanıcılar,
    // işlem kayıtları) da bu Container'ın içine gelecek — hepsi aynı hizada
    // dursun, blok başına ayrı genişlik olmasın.
    //
    // 1000px tesadüfi değil: dört sütunda kart başına ~235px düşüyor ve
    // "Çakışma (engel / uyarı)" etiketi tek satırda ancak bu genişlikte
    // kalıyor. Daha dar bir sınır etiketleri iki satıra kırıp kart
    // yüksekliklerini eşitsizleştiriyor.
    <Container size={1000} px={0}>
      <Title order={3} mb="md">Dashboard</Title>

      {/* 4×2 grid: üst sıra "ne var" (kaynaklar), alt sıra "kim ve ne oluyor".
          Dar ekranda 2 sütuna düşer — kart içeriği tek satır olduğu için
          daha fazla daraltmaya gerek yok. */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
        <StatCard label="Bölümler" value={data.departments} />
        <StatCard label="Derslikler" value={data.classrooms} />
        <StatCard label="Öğretim Üyeleri" value={data.lecturers} />
        <StatCard label="Dersler" value={data.courses} />

        <StatCard label="Admin" value={data.admins} />
        <StatCard label="Alt Hesap" value={data.sub_accounts} />
        <StatCard label="Sınavlar" value={data.exams} />

        {/* Çakışma tek kart ama iki sayı: hard submit'i engeller, warning
            engellemez (K-05). Tek toplam sayı bu ayrımı silerdi — 10 warning
            normal bir programdır, 10 hard ise program hiç yayınlanamaz. */}
        <StatCard
          label="Çakışma (engel / uyarı)"
          value={
            <Group gap={6} align="baseline" justify="center">
              <Text span inherit c={data.unresolved_hard > 0 ? "red" : undefined}>
                {data.unresolved_hard}
              </Text>
              <Text span inherit c="dimmed">/</Text>
              <Text span inherit c={data.unresolved_warnings > 0 ? "orange" : undefined}>
                {data.unresolved_warnings}
              </Text>
            </Group>
          }
        />
      </SimpleGrid>

      <Alert mt="lg" color="gray">
        Çakışma tablosu, kullanıcı yönetimi ve işlem kayıtları bu bloğun altına gelecek.
      </Alert>
    </Container>
  );
}
