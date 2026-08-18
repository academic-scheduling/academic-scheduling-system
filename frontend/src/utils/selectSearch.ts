import type { ComboboxItem, OptionsFilter } from "@mantine/core";

// Mantine Select'in varsayılan arama filtresi düz `toLowerCase()` kullanır;
// Türkçe "İ" → "i̇" (i + birleşik nokta U+0307) ürettiği için "ilke" araması
// "İlke EVRİM" seçeneğini BULAMAZ ama "İLKE" bulur. Çözüm: her iki tarafı da
// tr-locale küçük harfe indirmek (İ→i, I→ı). Backend'deki normalize.turkish_lower
// ile aynı ruh — arama, ada bakılırken büyük/küçük ve noktalı/noktasız i ayrımını
// yok saymalı.

/** Türkçe-farkında küçük harf: "İLKE"/"İlke" → "ilke", "IŞIK" → "ışık". */
export const trLower = (s: string): string => s.toLocaleLowerCase("tr");

/** Mantine Select/MultiSelect için Türkçe-duyarlı arama filtresi.
 *  `filter={turkishOptionsFilter}` olarak verilir. Düz seçenek listesi bekler
 *  (grup kullanılmıyor); etiketi ve aramayı tr-locale küçük harfe indirip
 *  alt-dize arar. */
export const turkishOptionsFilter: OptionsFilter = ({ options, search }) => {
  const q = trLower(search.trim());
  if (!q) return options;
  return (options as ComboboxItem[]).filter(
    (o) => "label" in o && trLower(o.label).includes(q),
  );
};
