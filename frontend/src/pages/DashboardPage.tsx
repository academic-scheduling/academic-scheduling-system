import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Alert, Anchor, Badge, Group, Loader, Paper, SimpleGrid, Table, Text, Title,
} from "@mantine/core";
import { api, ApiError } from "../api/client";
import UsersSection from "./UsersSection";
import type { ConflictResult, ConflictScan, DashboardSummary } from "../api/types";

/** Dashboard'da gösterilecek en fazla çakışma satırı.
 *
 *  Tümü listelenseydi altındaki kullanıcı ve log blokları sayfanın çok
 *  aşağısına düşerdi. Kesilen kısım için "Tümünü gör" bağlantısı var.
 */
const MAX_ROWS = 5;

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

/** Çakışma satırı: ağırlık rozeti + kural kimliği + motorun açıklaması.
 *
 *  Mesajı UI kurmuyor, motor kuruyor (kontrat §0). Brief §3.6 açık: çakışma
 *  "genel hata mesajı" değil, ne olduğunu anlatan bir cümleyle bildirilmeli.
 */
function ConflictRow({ conflict }: { conflict: ConflictResult }) {
  const hard = conflict.severity === "HARD";
  return (
    <Table.Tr>
      <Table.Td w={90}>
        {/* Renkler özet kartıyla aynı: engel kırmızı, uyarı turuncu.
            Metin de yazılır — rengi ayırt edemeyen kullanıcı için (brief §6.2). */}
        <Badge color={hard ? "red" : "orange"} variant="light" size="sm">
          {hard ? "ENGEL" : "UYARI"}
        </Badge>
      </Table.Td>
      <Table.Td w={60}>
        <Text size="sm" c="dimmed">{conflict.rule_id}</Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm">{conflict.message}</Text>
      </Table.Td>
    </Table.Tr>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [scan, setScan] = useState<ConflictScan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // İki uç paralel: ikisi de sunucuda aynı taramadan (scan_workgroup)
    // besleniyor, o yüzden karttaki sayı ile tablodaki satır sayısı ayrışamaz.
    Promise.all([
      api.get<DashboardSummary>("/dashboard/summary"),
      api.get<ConflictScan>("/conflicts"),
    ])
      .then(([ozet, tarama]) => { setData(ozet); setScan(tarama); })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Dashboard yüklenemedi"));
  }, []);

  if (error) return <Alert color="red" mt="md">{error}</Alert>;
  if (!data || !scan) return <Loader mt="xl" />;

  // Önce engeller, sonra uyarılar: kullanıcının ilk çözmesi gereken satır
  // üstte dursun. Çakışmanın zaman damgası yok (canlı hesaplanıyor, kontrat
  // §9), o yüzden "en yeni" diye bir sıralama mümkün değil — ağırlık tek
  // anlamlı sıralama ölçütü.
  const tumu = [...scan.hard, ...scan.warnings];
  const gosterilen = tumu.slice(0, MAX_ROWS);

  return (
    <>
      <Title order={3} mb="md">Dashboard</Title>

      {/* 4×2 grid: üst sıra "ne var" (kaynaklar), alt sıra "kim ve ne oluyor".
          Dar ekranda 2 sütuna düşer — kart içeriği tek satır olduğu için
          daha fazla daraltmaya gerek yok.

          Genişlik sınırı YALNIZ bu grid'e: geniş ekranda kartlar sayfaya
          yayılmasın diye ortalanıyor (mx="auto"). Başlık ve alttaki bloklar
          sayfanın kendi hizasında kalır.

          1000px tesadüfi değil: dört sütunda kart başına ~238px düşüyor ve
          "Çakışma (engel / uyarı)" etiketi tek satırda ancak bu genişlikte
          kalıyor. Daha dar bir sınır etiketleri iki satıra kırıp kart
          yüksekliklerini eşitsizleştiriyor. */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" maw={1000} mx="auto">
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

      <Group justify="space-between" align="baseline" mt="xl" mb="sm">
        <Title order={4}>Çakışmalar</Title>
        {tumu.length > MAX_ROWS && (
          <Anchor component={Link} to="/conflicts" size="sm">
            Tümünü gör ({tumu.length})
          </Anchor>
        )}
      </Group>

      <Paper withBorder radius="md">
        {gosterilen.length === 0 ? (
          <Text c="dimmed" size="sm" p="md">Çakışma bulunamadı.</Text>
        ) : (
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Tbody>
              {gosterilen.map((c, i) => (
                // Çakışmanın kalıcı bir id'si yok — canlı hesaplanıyor, bir
                // tabloda satırı yok. Sıra indeksi burada meşru bir anahtar:
                // liste her yüklemede baştan kuruluyor, araya ekleme olmuyor.
                <ConflictRow key={`${c.rule_id}-${i}`} conflict={c} />
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>

      <UsersSection />

      <Alert mt="lg" color="gray">
        İşlem kayıtları bu bloğun altına gelecek.
      </Alert>
    </>
  );
}
