import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Anchor, Group, SimpleGrid, Text, UnstyledButton } from "@mantine/core";
import {
  IconArrowBackUp, IconCircleCheck, IconClockHour4, IconFilePencil,
  type IconProps,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { TEXT_MUTED, TEXT_STRONG } from "../utils/scheduleTheme";
import type { DraftStatus, ScheduleDraft } from "../api/types";
import { useT } from "../i18n";
import type { Dict } from "../i18n/tr";

/** Kaç kayıt gösterilir. Tasarımda ızgara `repeat(4, minmax(0,1fr))`. */
const LIMIT = 4;

/* --- Durum paleti ---------------------------------------------------------
 *
 *  Değerler "Ana Sayfa v2" tasarımındaki STATUS tablosundan BİREBİR. Kartın
 *  rengi KENARLIKTA; zemin neredeyse beyaz (#FFFEFA gibi). Dolgulu bir ton
 *  denenmişti ve dört kart yan yana gelince sayfayı boyuyordu.
 *
 *  Tasarım yalnız aydınlık modu tanımlıyor; koyu karşılıklar uygulamanın kendi
 *  koyu rampasına (scheduleTheme) uyacak biçimde eklendi. `light-dark()` ile
 *  ikisi tek değerde duruyor — sabit hex iki tema için ayrı ayrı yönetilirdi. */
type DurumStil = {
  color: string;      // rozet yazısı + ikon + DOLU düğmenin zemini
  pill: string;       // rozet zemini
  border: string;     // kart kenarlığı
  bg: string;         // kart zemini
  /** Düğme yazısının rengi (zemin `color`). Aydınlıkta beyaz, ama koyu temada
   *  `color` açık bir pastel (#E8B84B gibi) ve üstünde beyaz okunmuyor — o
   *  yüzden ayrı bir alan, `#fff` sabiti değil. */
  onColor: string;
  Icon: ComponentType<IconProps>;
};

const STATUS: Record<DraftStatus, DurumStil> = {
  OPEN: {
    color: "light-dark(#B45309, #E8B84B)", pill: "light-dark(#FFFBEB, #33301F)",
    border: "light-dark(#FDE68A, #6B5D2A)", bg: "light-dark(#FFFEFA, #2A2822)",
    onColor: "light-dark(#FFFFFF, #241E0B)",
    Icon: IconFilePencil,
  },
  PENDING: {
    color: "light-dark(#2563EB, #6EA8FE)", pill: "light-dark(#EFF6FF, #1E2738)",
    border: "light-dark(#BFDBFE, #2F4A78)", bg: "light-dark(#FCFDFF, #24272E)",
    onColor: "light-dark(#FFFFFF, #0F1930)",
    Icon: IconClockHour4,
  },
  REJECTED: {
    color: "light-dark(#EF4444, #F08A8A)", pill: "light-dark(#FEF2F2, #35211F)",
    border: "light-dark(#FECACA, #6E3B3B)", bg: "light-dark(#FFFCFC, #2B2426)",
    onColor: "light-dark(#FFFFFF, #2B1414)",
    Icon: IconArrowBackUp,
  },
  APPROVED: {
    color: "light-dark(#16A34A, #5FD08A)", pill: "light-dark(#F0FDF4, #1B2E22)",
    border: "light-dark(#BBF7D0, #2F6B45)", bg: "light-dark(#FCFFFD, #232A26)",
    onColor: "light-dark(#FFFFFF, #0E2417)",
    Icon: IconCircleCheck,
  },
};

/** Tür rozeti: haftalık teal, sınav mor — yine tasarımdan. Durum renginden
 *  AYRI bir eksen; ikisi aynı renkte olsaydı "onay bekleyen sınav" ile "onay
 *  bekleyen program" ayırt edilemezdi. */
const KIND_STYLE = {
  WEEKLY: { bg: "light-dark(#F0FDFA, #16302C)", fg: "light-dark(#0F766E, #5FCFC0)" },
  EXAM:   { bg: "light-dark(#F5F3FF, #272042)", fg: "light-dark(#6D28D9, #B49BF0)" },
};

/** Çakışma sayacı: sıfırda susturulmuş, sıfırdan büyükte kırmızı. Tasarım
 *  engel/uyarı ayrımı YAPMIYOR — sayaç "bak buraya" diyen bir işaret, kuralın
 *  ağırlığı Yayın Merkezi'nde okunuyor. (`blocking_count` yine de elde.) */
const NOTR = "light-dark(#94A3B8, #6E7178)";
const CAKISMA = "light-dark(#EF4444, #F08A8A)";

/** Gün + saat; yıl yok — panel SON hareketleri gösteriyor, yıl gürültü olurdu. */
function kisaZaman(iso: string, t: Dict): string {
  return new Date(iso).toLocaleString(t.locale, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

/** Kartın açıklama satırı — duruma göre ZATEN elde olan alandan gelir; ek
 *  sunucu turu yok. Boş kalabilir: blok yine de yer kaplar (min-height), o
 *  yüzden düğmeler hizadan çıkmaz. */
function aciklama(d: ScheduleDraft): string | null {
  if (d.status === "REJECTED") return d.review_note;
  if (d.status === "APPROVED") return d.applied_summary;
  if (d.status === "PENDING") return d.submit_note;
  return null;
}

/**
 * Ana sayfadaki "Taslaklar ve onaylar" bandı (K-85).
 *
 *  Yayın Merkezi'nde görünen kayıtların EN SON DEĞİŞENİ dört tanesi. Eskiden
 *  burada "Son onaylar" (ChangeFeed) duruyordu: yalnız BİTMİŞ işleri
 *  gösteriyordu ve "şu an neyin üzerinde çalışıyorum" sorusunu cevapsız
 *  bırakıyordu. Yarım kalan taslak da, bana gelen onay talebi de aynı listede
 *  olmalı — ikisi de "bir sonraki işim" adayı.
 *
 *  Sıralama `updated_at`e göre (K-85'te eklendi): taslağın İÇİNDE yapılan
 *  değişiklik de, gönderim/onay/ret de o alana dokunuyor.
 *
 *  Kutu ölçüleri "Ana Sayfa v2" tasarımından: kart 10px yarıçap, 12/13px dolgu,
 *  9px iç boşluk; başlık 15/700; rozetler 20px yüksekliğinde; ızgara 12px
 *  aralıklı. Panelin DIŞINDA kart YOK — başlık ve ızgara doğrudan sayfa
 *  zemininde durur; sarmalayıcı bir Paper kart-içinde-kart görüntüsü üretiyordu.
 */
export default function RecentPublishing() {
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<ScheduleDraft[] | null>(null);

  useEffect(() => {
    // Yayın Merkezi'nin okuduğu UÇLARIN AYNISI — kapsam (kimin neyi görebildiği)
    // orada üç ayrı görünürlük kuralıyla çözülmüş durumda ve burada yeniden
    // türetmek iki ekranı zamanla ayrıştırırdı.
    const jobs = [
      api.get<ScheduleDraft[]>("/schedule-drafts"),
      api.get<ScheduleDraft[]>("/schedule-approvals/history"),
    ];
    if (user?.can_approve_schedule) {
      jobs.push(api.get<ScheduleDraft[]>("/schedule-approvals"));
    }
    Promise.all(jobs)
      .then((listeler) => {
        // Aynı kayıt iki uçtan gelebilir: kendi bekleyen talebim hem
        // "taslaklarım"da hem onay kuyruğunda. id ile tekilleştiriliyor.
        const m = new Map<number, ScheduleDraft>();
        for (const liste of listeler) for (const d of liste) m.set(d.id, d);
        setItems([...m.values()]
          .sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at))
          .slice(0, LIMIT));
      })
      // İKİNCİL panel: hatası ana sayfayı bozmamalı, boş görünür.
      .catch(() => setItems([]));
  }, [user]);

  if (items === null) return null;          // henüz yüklenmedi

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Group justify="space-between" align="baseline" gap={12}>
        <Text fz={15} fw={700} c={TEXT_STRONG}>{t.recentPublishing.title}</Text>
        <Anchor component="button" type="button" fz={12} fw={600}
          onClick={() => navigate("/publishing")}>
          {t.recentPublishing.openCenter}
        </Anchor>
      </Group>

      {items.length === 0 ? (
        <Text fz={12} c={TEXT_MUTED}>{t.recentPublishing.empty}</Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: LIMIT }} spacing={12}>
          {items.map((d) => {
            const st = STATUS[d.status];
            const kind = KIND_STYLE[d.kind === "EXAM" ? "EXAM" : "WEEKLY"];
            const not = aciklama(d);
            return (
              <div key={d.id} style={{
                border: `1px solid ${st.border}`,
                borderRadius: 10,
                background: st.bg,
                boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
                padding: "12px 13px 13px",
                display: "flex", flexDirection: "column", gap: 9,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 5, height: 20,
                    padding: "0 8px", borderRadius: 10, background: st.pill,
                    color: st.color, fontSize: 11, fontWeight: 700,
                  }}>
                    <st.Icon size={13} />{t.draft.status[d.status]}
                  </span>
                  {/* Tür etiketi Değişiklik Akışı'ndaki sözcüklerin AYNISI —
                      aynı kavram iki ekranda iki farklı adla anılmasın. */}
                  <span style={{
                    display: "inline-flex", alignItems: "center", height: 20,
                    padding: "0 8px", borderRadius: 10, background: kind.bg,
                    color: kind.fg, fontSize: 11, fontWeight: 600,
                  }}>
                    {d.kind === "EXAM" ? t.changeFeed.examSchedule : t.changeFeed.weeklySchedule}
                  </span>
                </div>

                <div style={{ minWidth: 0 }}>
                  <Text fz={14} fw={600} c={TEXT_STRONG} lh={1.35} truncate>
                    {d.department_code} · {t.courses.yearN(d.year)} · {t.enums.semester[d.semester]}
                  </Text>
                  <Text fz={12} c={TEXT_MUTED} mt={2} truncate>
                    {d.owner.name} · {kisaZaman(d.updated_at, t)}
                  </Text>
                </div>

                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{
                    fontSize: 20, fontWeight: 700, lineHeight: 1,
                    color: d.conflict_count === 0 ? NOTR : CAKISMA,
                    fontVariantNumeric: "tabular-nums",
                  }}>{d.conflict_count}</span>
                  <Text fz={12} c={TEXT_MUTED}>
                    {t.recentPublishing.conflicts} · {t.publishing.changeCount(d.change_count)}
                  </Text>
                </div>

                {/* Düğmeleri hizalayan şey BU: kartlar farklı uzunlukta not
                    taşısa da (ya da hiç taşımasa da) blok aynı yeri kaplar.
                    Flex'e "kalanı doldur" demek yerine SABİT yer ayrılıyor —
                    tasarımdaki min-height:34px. */}
                <Text fz={12} c={TEXT_MUTED} lh={1.45} lineClamp={2}
                  style={{ minHeight: 34 }}>
                  {not ?? ""}
                </Text>

                {/* Etiket HER KARTTA aynı ("Görüntüle"): buradaki iş "bak",
                    karar Yayın Merkezi'nde veriliyor. Tasarımda etiket duruma
                    göre değişiyor (Geri çek / Onaya gönder / Aç) ve dolgu
                    "asıl eylem" olanı işaretliyor; etiket tekleşince o ayrım
                    keyfi kalırdı, o yüzden RENK devraldı: her düğme kendi
                    durumunun rengiyle dolu. Kart hangi durumdaysa düğmesi de
                    onu söylüyor. */}
                <UnstyledButton
                  onClick={() => navigate(`/publishing?draft_id=${d.id}`)}
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    height: 32, padding: "0 12px", fontSize: 12, fontWeight: 600,
                    border: "none",
                    background: st.color,
                    color: st.onColor,
                    borderRadius: 6,
                  }}>
                  {t.recentPublishing.view}
                </UnstyledButton>
              </div>
            );
          })}
        </SimpleGrid>
      )}
    </div>
  );
}
