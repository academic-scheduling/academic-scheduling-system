import { useEffect, useState } from "react";
import { ActionIcon, Anchor, Badge, Group, Popover, Stack, Text } from "@mantine/core";
import { IconCheck, IconInfoCircle } from "@tabler/icons-react";
import { lecturerLabel } from "../api/types";
import type { Course, SessionType } from "../api/types";
import { useT } from "../i18n";

/** Programdaki (haftalık/sınav) ders listelerinde dersin sağındaki "i" — tıklayınca
 *  dersin özetini + ŞUBE bilgisini pop-up'ta gösterir; ayrıntı için Dersler
 *  sekmesine yönlendirir.
 *
 *  Açık durum DIŞARIDAN yönetilir (`opened` + `onOpenChange`): tek bir paylaşılan
 *  "açık ders" state'i ile aynı anda YALNIZCA BİR pop-up açık kalır (üst üste
 *  binme yok). Palet kartları sürüklenebilir / tıklanabilir olduğu için mousedown
 *  yayılımı durdurulur (tıklama sürükleme/seçme tetiklemesin). */
/** Sınav sayfası pop-up'ında gösterilecek tek sınav satırı. */
export type CourseInfoExam = { label: string; date: string; time: string };

/** Oturum türleri sabit sırada: ilerleme metni hep aynı okunsun. */
const SESSION_TYPES: SessionType[] = ["THEORY", "PRACTICE", "LAB"];

export function CourseInfoButton({ course, opened, onOpenChange, onOpenCourses, exams,
                                   placedBySection }: {
  course: Course;
  opened: boolean;
  onOpenChange: (opened: boolean) => void;
  onOpenCourses: () => void;
  /** Verilirse (Sınavlar sayfası) şube YERİNE sınav bilgisi gösterilir. Undefined
   *  ise (Haftalık) şube listesi gösterilir. */
  exams?: CourseInfoExam[];
  /** K-85: şube id → o şubede YERLEŞEN slot sayısı (T/U/L ayrı ayrı).
   *
   *  Verilirse her şube satırının sağında ilerleme görünür: hedefleri
   *  karşılıyorsa tik, karşılamıyorsa "T3/3 · L0/2". Amaç paletteki tikin NEDEN
   *  gelmediğini şube kırılımında görebilmek — palet yalnız ders düzeyinde
   *  "tamam/eksik" diyor.
   *
   *  Sınavlar sayfasında verilmez: orada haftalık yerleşim kavramı yok. */
  placedBySection?: Map<number, Record<SessionType, number>>;
}) {
  const t = useT();

  /** Bir şubenin T/U/L ilerlemesi. Kural PALETLE BİREBİR AYNI (konan >= hedef,
   *  üç bileşen için): ikisi ayrışırsa pop-up ile paletteki tik birbirini
   *  yalanlar.
   *
   *  Saati 0 olan bileşen listelenmez — ama YERLEŞMİŞSE listelenir. "T5/3"
   *  gibi bir satır, oturum türü yanlış seçilmiş bir yerleşimi ele veren tek
   *  işarettir (lab bloğu Teori olarak kaydedilirse sayı böyle şişer). */
  const ilerleme = (sectionId: number) => {
    if (!placedBySection) return null;
    const konan = placedBySection.get(sectionId) ?? { THEORY: 0, PRACTICE: 0, LAB: 0 };
    const hedef: Record<SessionType, number> = {
      THEORY: course.hours_theory,
      PRACTICE: course.hours_practice,
      LAB: course.hours_lab,
    };
    const parcalar = SESSION_TYPES
      .filter((k) => hedef[k] > 0 || konan[k] > 0)
      .map((k) => `${t.courseInfo.sessionLetters[k]}${konan[k]}/${hedef[k]}`);
    return { tam: SESSION_TYPES.every((k) => konan[k] >= hedef[k]), metin: parcalar.join(" · ") };
  };
  const sections = [...course.sections]
    .filter((s) => s.active)
    .sort((a, b) => a.section_no - b.section_no);

  // K-76: pop-up artık HOVER'da da açılır (yalnız tıklama değil). Tıklama SABİTLER
  // (pinned) — sabitken fareyi çekince kapanmaz, böylece içindeki bağlantıya
  // gidilebilir. Hover'la açıldıysa fareyi çekince kapanır. Başka bir "i" açılınca
  // (opened dışarıdan false olur) sabitleme sıfırlanır.
  const [pinned, setPinned] = useState(false);
  useEffect(() => { if (!opened) setPinned(false); }, [opened]);

  return (
    // İlerleme sütunu eklenince 280px'e hoca adı + "T3/3 · L0/2" birlikte
    // sığmıyor ve isimler agresif kırpılıyordu; o sütun varken pop-up genişler.
    <Popover width={placedBySection ? 344 : 280} position="right-start" withArrow shadow="md" withinPortal
      opened={opened} onChange={onOpenChange}>
      <Popover.Target>
        <ActionIcon
          size="sm" variant="subtle" color="gray" radius="sm"
          aria-label={`${course.code} bilgisi`}
          draggable={false}
          onMouseDown={(e) => e.stopPropagation()}
          onDragStart={(e) => e.preventDefault()}
          onMouseEnter={() => { if (!pinned) onOpenChange(true); }}
          onMouseLeave={() => { if (!pinned) onOpenChange(false); }}
          // Kontrollü modda Popover.Target kendiliğinden açılmaz; toggle'ı biz
          // yaparız. Tıklama sabitler/çözer. stopPropagation kartın kendi
          // tıklama/sürükleme davranışını engeller.
          onClick={(e) => {
            e.stopPropagation();
            const willOpen = !opened || !pinned;
            setPinned(willOpen);
            onOpenChange(willOpen);
          }}
        >
          <IconInfoCircle size={15} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown onMouseDown={(e) => e.stopPropagation()}>
        <Stack gap={6}>
          <div>
            <Text fw={600} fz="sm">{course.code}</Text>
            <Text fz="xs" c="dimmed">{course.name}</Text>
          </div>
          <Text fz="xs">
            {course.is_common
              ? t.courseInfo.commonCourseHours(course.hours_theory,
                                               course.hours_practice, course.hours_lab)
              : t.courseInfo.yearSemester(course.year, t.enums.semester[course.semester])
                + t.courseInfo.hoursOf(course.hours_theory,
                                       course.hours_practice, course.hours_lab)}
            {course.ects != null ? t.courseInfo.ectsOf(course.ects) : ""}
          </Text>
          <Group gap={4}>
            <Badge size="xs" variant="light" color={course.is_elective ? "grape" : "blue"}>
              {course.is_elective ? t.courseInfo.elective : t.courseInfo.required}
            </Badge>
            {course.is_common && (
              <Badge size="xs" variant="light" color="teal">{t.courseInfo.common}</Badge>
            )}
          </Group>

          {/* Sınavlar sayfasında SINAV bilgisi, haftalıkta ŞUBE bilgisi. Küçük
              başlık + kompakt satırlar — ders kod/adından baskın görünmesin. */}
          {exams !== undefined ? (
            <div>
              <Text fz={10} fw={700} c="dimmed" tt="uppercase" mb={2}>{t.courseInfo.exams}</Text>
              {exams.length === 0 ? (
                <Text fz={11} c="dimmed">{t.courseInfo.noExams}</Text>
              ) : (
                <Stack gap={1}>
                  {exams.map((ex, i) => (
                    <Text key={i} fz={11} lh={1.25}>
                      <Text span fw={600}>{ex.label}</Text>
                      <Text span c="dimmed"> · {ex.date} {ex.time}</Text>
                    </Text>
                  ))}
                </Stack>
              )}
            </div>
          ) : (
            <div>
              <Text fz={10} fw={700} c="dimmed" tt="uppercase" mb={2}>
                {t.courseInfo.sectionsCount(sections.length)}
              </Text>
              {sections.length === 0 ? (
                <Text fz={11} c="dimmed">{t.courseInfo.noSections}</Text>
              ) : (
                <Stack gap={1}>
                  {sections.map((s) => {
                    const ilr = ilerleme(s.id);
                    return (
                    <Group key={s.id} gap={6} wrap="nowrap" justify="space-between" align="center">
                      <Text fz={11} lh={1.25} truncate style={{ minWidth: 0 }}>
                        <Text span fw={600}>{t.courseInfo.sectionNo(s.section_no)}</Text>{" "}
                        {lecturerLabel(s.lecturer)}
                      </Text>
                      {ilr && (ilr.tam ? (
                        // Palet tikiyle AYNI ikon ve renk: aynı şeyi söyleyen
                        // iki farklı işaret olmasın.
                        <IconCheck size={13} stroke={2.4} color="#16A34A"
                          style={{ flexShrink: 0 }} aria-label={t.courseInfo.placementDone} />
                      ) : (
                        <Text fz={10} c="dimmed" style={{
                          flexShrink: 0, fontVariantNumeric: "tabular-nums",
                        }}>{ilr.metin}</Text>
                      ))}
                    </Group>
                    );
                  })}
                </Stack>
              )}
            </div>
          )}

          <Anchor component="button" type="button" fz="xs"
            onClick={() => { onOpenChange(false); onOpenCourses(); }}>
            {t.courseInfo.openInCourses}
          </Anchor>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
