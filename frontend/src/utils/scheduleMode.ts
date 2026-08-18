/** K-73: Haftalık/Sınav ekranında bir cohort'u en son hangi modda bıraktığımı
 *  (yayın mı, belirli bir taslak mı) hatırlar. Sayfa değiştirip dönünce kullanıcı
 *  bıraktığı yere döner — eskiden ekran her dönüşte açık taslağa atlıyordu.
 *
 *  localStorage'da tutulur (ucuz, senkron, sunucu turu gerektirmez → "en
 *  optimizasyonlu yol"): mevcut cohort/taslak sorguları zaten atılıyor, bu yalnız
 *  o sorgulardan gelen listeden HANGİSİNİ seçeceğimizi belirleyen bir tercih.
 *
 *  Değer: "pub" (yayında bırakıldı) | taslak id (sayı) | null (tercih yok →
 *  eski davranış: varsa açık taslağı seç).
 */

const cohortKey = (prefix: string, dep: string | null, year: string, sem: string) =>
  `${prefix}:${dep ?? ""}/${year}/${sem}`;

export function readScheduleMode(
  prefix: string, dep: string | null, year: string, sem: string,
): "pub" | number | null {
  try {
    const raw = localStorage.getItem(cohortKey(prefix, dep, year, sem));
    if (raw === "pub") return "pub";
    if (raw && /^\d+$/.test(raw)) return Number(raw);
  } catch { /* localStorage erişilemezse tercih yok gibi davran */ }
  return null;
}

export function writeScheduleMode(
  prefix: string, dep: string | null, year: string, sem: string,
  mode: "pub" | number,
): void {
  try {
    localStorage.setItem(cohortKey(prefix, dep, year, sem), String(mode));
  } catch { /* kota/gizli mod: tercih kaydedilemezse sessizce geç */ }
}
