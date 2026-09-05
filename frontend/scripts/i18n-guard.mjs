/**
 * K-89 · Çeviri bekçisi — arayüzde sözlüğe bağlanmamış Türkçe metin var mı?
 *
 * NEDEN VAR
 * ---------
 * K-79 tüm arayüzü sözlüğe bağladı, ama bağ tek yönlü: yeni bir metni doğrudan
 * JSX'e yazmak hiçbir hata üretmez, yalnızca İngilizce modda Türkçe kalır. Bu
 * sessiz bir bozulmadır — kimse İngilizceye geçmediği sürece fark edilmez.
 * K-89'da böyle 40'tan fazla metin bulundu; hepsi ayrı zamanlarda, hepsi aynı
 * şekilde eklenmişti. Bekçi, aynı hatanın 41.'sini yazıldığı gün yakalar.
 *
 * NASIL ÇALIŞIR
 * -------------
 * Kelime dağarcığını KENDİ SÖZLÜĞÜMÜZDEN üretir: tr.ts'te geçip en.ts'te
 * geçmeyen kelimeler "Türkçeye özgü" sayılır. Bir kod dosyasındaki metin
 * literalinin TÜM kelimeleri bu kümedeyse, o metin sözlüğe bağlanmamış Türkçe
 * metindir.
 *
 * Bu yaklaşım "ğüşıöç harfi ara" sezgisinden üstün: "derslik yok" gibi tamamı
 * ASCII olan Türkçe metinleri de yakalar (K-89'da tam olarak bu kaçmıştı).
 * Sözlük büyüdükçe dağarcık da büyür; bakım gerektirmez.
 *
 * KULLANIM
 *   npm run lint:i18n
 * Çıkış kodu 1 ise sızıntı var; liste stdout'a yazılır.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const KOK = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");
const I18N = join(KOK, "i18n");

/** Bilerek Türkçe kalan, çeviriye TABİ OLMAYAN değerler.
 *  Bunlar etiket değil VERİdir: backend'in kanonik kümeleriyle eşleşmeleri
 *  gerekir, çevrilirlerse eşleşme bozulur. */
const IZINLI = [
  // app/normalize.py CANONICAL_TITLES aynası (LecturersPage TITLES)
  "Prof. Dr.", "Prof.", "Doç. Dr.", "Doç.", "Dr. Öğr. Üyesi",
  "Öğr. Gör. Dr.", "Öğr. Gör.", "Arş. Gör. Dr.", "Arş. Gör.", "Uzman", "Dr.",
  "Doç", "Dr. Öğr", "Öğr. Gör", "Arş. Gör",
];

function* dosyalar(dizin) {
  for (const ad of readdirSync(dizin)) {
    const yol = join(dizin, ad);
    if (statSync(yol).isDirectory()) {
      if (yol.startsWith(I18N)) continue;      // sözlüğün kendisi taranmaz
      yield* dosyalar(yol);
    } else if (/\.tsx?$/.test(ad)) {
      yield yol;
    }
  }
}

/** Yorumları, satır sayısını KORUYARAK boşaltır (satır numarası doğru kalsın). */
function yorumsuz(metin) {
  const bosalt = (m) => m.replace(/[^\n]/g, " ");
  return metin
    .replace(/\/\*[\s\S]*?\*\//g, bosalt)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, bosalt)
    .replace(/\/\/[^\n]*/g, bosalt);
}

/** Bir sözlük dosyasındaki metin değerlerinin kelimeleri. */
function sozlukKelimeleri(yol) {
  const metin = readFileSync(yol, "utf8");
  const kume = new Set();
  for (const m of metin.matchAll(/"([^"\n]{2,})"|`([^`\n]{2,})`/g)) {
    const deger = (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, " ");
    for (const w of deger.match(/[A-Za-zğüşıöçĞÜŞİÖÇ]{3,}/g) ?? []) {
      kume.add(w.toLowerCase());
    }
  }
  return kume;
}

const trKelime = sozlukKelimeleri(join(I18N, "tr.ts"));
const enKelime = sozlukKelimeleri(join(I18N, "en.ts"));
// Türkçe'de geçip İngilizce'de geçmeyenler: "auth", "api", "hard" gibi ortak
// teknik kelimeler böylece kendiliğinden elenir.
const TURKCE = new Set([...trKelime].filter((w) => !enKelime.has(w)));

const izinliKume = new Set(IZINLI.map((s) => s.toLowerCase()));
const bulgular = [];

/** Bu literal kullanıcıya gösterilen bir CÜMLE/ETİKET mi, yoksa tanımlayıcı mı?
 *
 *  Ayrım büyük/küçük harfe dayanır ve kasıtlı olarak basittir: arayüz etiketleri
 *  ya çok kelimelidir ("Pasife al") ya da Büyük harfle başlayan tek kelimedir
 *  ("Kaydet", "Ekle", "Teori"). Kod tanımlayıcıları ise ya tamamı küçük ("hard",
 *  "size" — bu ikisi Türkçe sözlükte de geçtiği için eleyici olmadan yanlış
 *  alarm üretirdi) ya da tamamı BÜYÜK ("HARD") olur. */
function etiketGorunumlu(kelimeler) {
  if (kelimeler.length > 1) return true;
  return /^[A-ZĞÜŞİÖÇ][a-zğüşıöç]/.test(kelimeler[0]);
}

/** Metin sözlüğe bağlanmamış Türkçe mi? Öyleyse bulgulara ekler. */
function incele(ham, yol, satirNo) {
  if (izinliKume.has(ham.toLowerCase().trim())) return;
  if (/^[./]/.test(ham.trim())) return;                       // import yolu
  const govde = ham.replace(/\$\{[^}]*\}/g, " ");
  const kelimeler = govde.match(/[A-Za-zğüşıöçĞÜŞİÖÇ]{3,}/g) ?? [];
  if (kelimeler.length === 0) return;
  if (!etiketGorunumlu(kelimeler)) return;
  // TÜM kelimeler Türkçeye özgüyse: sözlüğe bağlanmamış Türkçe metin.
  if (kelimeler.every((w) => TURKCE.has(w.toLowerCase()))) {
    bulgular.push({ yol: relative(KOK, yol), satir: satirNo, metin: ham.trim() });
  }
}

for (const yol of dosyalar(KOK)) {
  const kaynak = yorumsuz(readFileSync(yol, "utf8"));

  // --- 1) String / template literalleri ---
  kaynak.split("\n").forEach((satir, i) => {
    // Geliştirici log'ları kullanıcıya gösterilmez, çevrilmeleri gerekmez.
    if (/\bconsole\.\w+\(/.test(satir)) return;
    for (const m of satir.matchAll(/"([^"\n]{3,})"|'([^'\n]{3,})'|`([^`\n]{3,})`/g)) {
      incele(m[1] ?? m[2] ?? m[3], yol, i + 1);
    }
  });

  // --- 2) JSX DÜZ METNİ ---
  // Bu ayrı bir tarama olmak ZORUNDA: JSX çocuk metni tırnak içinde DEĞİLDİR,
  // yani literal taraması onu göremez. K-89'u başlatan hata (`{n} değişiklik`)
  // ve PlaceholderPage'in tek cümlesi tam olarak bu sınıftandı.
  // Sınırlar `>`/`}` ile `<`/`{`: böylece hem düz metin hem de ifadeyle
  // karışık metin ("{sayı} değişiklik") yakalanır. Çok satırlı metinler de
  // eşleşir; satır numarası eşleşmenin konumundan hesaplanır.
  for (const m of kaynak.matchAll(/[>}]([^<>{}]{3,}?)[<{]/gs)) {
    const ham = m[1];
    if (!/[A-Za-zğüşıöçĞÜŞİÖÇ]/.test(ham)) continue;
    // JSX dışındaki kod da `}` ile `{` arasında kalabiliyor (örn. `}));`
    // ile `const ortak = {`). Metin olmayanı kod noktalamasından ayırıyoruz.
    if (/[=;()[\]]|=>/.test(ham)) continue;
    const satirNo = kaynak.slice(0, m.index).split("\n").length;
    incele(ham.replace(/\s+/g, " "), yol, satirNo);
  }
}

if (bulgular.length === 0) {
  console.log("i18n bekçisi: sözlüğe bağlanmamış Türkçe metin yok.");
  process.exit(0);
}

console.error(`i18n bekçisi: ${bulgular.length} sözlüğe bağlanmamış metin bulundu.\n`);
for (const b of bulgular) {
  console.error(`  src/${b.yol.replace(/\\/g, "/")}:${b.satir}  ${JSON.stringify(b.metin)}`);
}
console.error(
  "\nHer birini tr.ts + en.ts'e bir anahtar olarak taşıyıp `t.<bölüm>.<anahtar>`" +
  "\nile kullanın. Metin gerçekten VERİ ise (backend'in kanonik değeri gibi)" +
  "\nscripts/i18n-guard.mjs içindeki IZINLI listesine ekleyin."
);
process.exit(1);
