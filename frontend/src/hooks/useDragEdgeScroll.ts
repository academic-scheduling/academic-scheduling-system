import { useEffect, useRef, type RefObject } from "react";

// Kenar bölgesi kalınlığı ve tik başına maksimum kaydırma (px). Kenara ne kadar
// yaklaşılırsa kaydırma o kadar hızlanır (0 → MAX), ani sıçrama olmaz.
const EDGE = 80;
const MAX = 22;

function ramp(overlap: number): number {
  return Math.min(MAX, (Math.max(0, overlap) / EDGE) * MAX);
}

/** Native (HTML5) sürükleme sırasında imleç ekran kenarına gelince programı o
 *  yöne doğru otomatik kaydırır. Böylece grid ekrana sığmasa bile görünmeyen
 *  hücrelere ders bırakılabilir.
 *
 *  - DİKEY kaydırma pencerede (sayfa) yapılır — takvim aşağı/yukarı taşarsa;
 *    tetik bölgesi ekranın (viewport) üst/alt kenarıdır.
 *  - YATAY kaydırma verilen elemanda (grid'in overflowX kutusu) yapılır — günler
 *    yana taşarsa; tetik bölgesi GRID'İN KENDİ sol/sağ kenarıdır (viewport değil).
 *    Böylece solda palet/menü olsa da grid'in soluna yaklaşınca kayar, ekranın
 *    en soluna gitmek gerekmez.
 *
 *  İmleç konumu window'daki `dragover`dan okunur (olay drop hedefinden window'a
 *  köpürür), sürekli kaydırma ise bir zamanlayıcıyla yapılır: imleç kenarda
 *  SABİT dursa bile (dragover tekrar tetiklenmese de) kaydırma devam eder.
 *  Zamanlayıcı olarak setInterval kullanılır — native sürükleme sırasında
 *  requestAnimationFrame bazı tarayıcılarda duraklayabilir, setInterval koşar.
 */
export function useDragEdgeScroll(
  active: boolean,
  horizontalRef: RefObject<HTMLElement | null>,
) {
  const pos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!active) return;

    const onDragOver = (e: DragEvent) => {
      pos.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("dragover", onDragOver);

    const timer = window.setInterval(() => {
      const p = pos.current;
      if (!p) return;
      const vh = window.innerHeight;

      // Dikey → pencere (sayfa); tetik viewport üst/alt kenarı
      if (p.y < EDGE) window.scrollBy(0, -ramp(EDGE - p.y));
      else if (p.y > vh - EDGE) window.scrollBy(0, ramp(p.y - (vh - EDGE)));

      // Yatay → grid'in kaydırma kutusu; tetik GRID'İN kendi sol/sağ kenarı.
      // Yalnız imleç grid'in dikey bandındayken kaydır (palet/başlık üzerindeyken
      // değil) ve yalnız grid'in x aralığında (soldaki paletteyken tetiklenmesin).
      const el = horizontalRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const inBand = p.y >= r.top && p.y <= r.bottom;
        if (inBand) {
          if (p.x >= r.left && p.x < r.left + EDGE) {
            el.scrollLeft -= ramp(r.left + EDGE - p.x);
          } else if (p.x <= r.right && p.x > r.right - EDGE) {
            el.scrollLeft += ramp(p.x - (r.right - EDGE));
          }
        }
      }
    }, 16);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("dragover", onDragOver);
      pos.current = null;
    };
  }, [active, horizontalRef]);
}
