"""Muğla Sıtkı Koçman Ü. Mühendislik Fakültesi akademik personel scraper (K-50).

K-08 "fakülte hocaları: fakülte web sayfasından bir kerelik import" kararının
somut hali; karar defteri açık konu 4 (kaynağın URL'i ve veri yapısı) bu
modülle kapanır. `POST /lecturers/import/*` uçları buradan beslenir.

Sitenin iki katmanı vardır:
  1. LİSTE sayfası (fakülte alt alanı) — ad + unvan + Detay linki. Bölüm YOK.
  2. DETAY sayfası (üniversite ana alanı, farklı domain) — e-posta ve
     "Kadro Bilgileri" içinde Görev Birimi / Kadro Birimi.

TASARIM:
  - **Saf ayrıştırma** (`parse_list` / `parse_detail`) ağdan bağımsızdır; HTML
    string alır. Böylece kaydedilmiş fixture'larla test edilir (test_lecturer_import).
  - **Ağ katmanı** (`fetch_list` / `fetch_detail`) httpx ile — kısa timeout,
    tarayıcı UA. Yeni bağımlılık yok: httpx + bs4 zaten requirements'ta.
  - **GÜRÜLTÜLÜ HATA:** dolu bir sayfadan 0 kişi ayrıştırılırsa `ScrapeError`
    fırlatır. Scraping kırılgandır; site markup'ı sessizce değişince "0 yeni
    hoca" gibi sessiz bir yalan yerine görünür bir hata olmalı — aksi halde
    bozuk parser çakışma tespitinin kimlik anahtarını (K-08) çürütür.
  - **Site sözleşmesi TEK yerde:** tüm selector'lar bu dosyadadır. Site
    değişirse yalnız bu modül + fixture testi kırılır, başka hiçbir şey.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import httpx
from bs4 import BeautifulSoup

from app.normalize import canonical_title

# Sunucudan sunucuya çekim; kimliğimizi dürüstçe bildiren bir UA (bazı sunucular
# UA'sız isteği reddediyor). Kaynak site kendi üniversitemiz, veri herkese açık.
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; academic-scheduling-import/1.0; "
        "+fakulte personel iceri aktarma)"
    )
}
# Kaynak sunucu bizi throttle edebiliyor (olculdu: ~117 KB/s); 252 KB'lik bir
# detay sayfasi yavas anlarda 15 sn'yi zorluyordu. 30 sn: yavas-ama-calisan
# sayfa sahte sekilde basarisiz olup kisiyi bolumsuz birakmasin.
_TIMEOUT = 30.0
# NOT: Paylasilan keep-alive istemci denendi ve GERI ALINDI — throttling
# altinda havuzdaki baglanti bayatlayip ReadTimeout uretiyor (kisi sessizce
# detaysiz kaliyor) ve olcumde per-request'ten daha yavasti. Istek basina taze
# baglanti daha sade ve daha guvenilir; hiz kazanci eszamanliliktan gelir.


class ScrapeError(RuntimeError):
    """Site çekilemedi ya da beklenen yapı bulunamadı (muhtemelen markup değişti)."""


@dataclass
class PersonRef:
    """Liste sayfasından bir satır: kimlik + detay sayfasının adresi.

    K-52: unvan ad'dan AYRI (önce birleşikti). full_name yalnız ad; title
    kanonik kısa forma eşlenmiş unvan (site "Doktor Öğretim Üyesi" yazar).
    """

    full_name: str          # yalnız ad, örn. "Ali Arslan KAYA"
    detail_url: str
    title: str | None = None   # kanonik unvan, örn. "Prof. Dr." (yoksa None)


@dataclass
class PersonDetail:
    """Detay sayfasından okunan alanlar (hepsi opsiyonel — sayfa eksik olabilir)."""

    duty_unit: str | None   # Görev Birimi'nin "Bölüm" segmenti
    cadre_unit: str | None  # Kadro Birimi'nin "Bölüm" segmenti
    email: str | None


# ----------------------------------------------------------------------------
# Saf ayrıştırma (ağ yok, fixture ile test edilir)
# ----------------------------------------------------------------------------

def parse_list(html: str) -> list[PersonRef]:
    """Liste HTML'inden kişileri çıkarır.

    Her kişi `div.person` içindedir: `.perName` (ad), `.perTitle` (unvan) ve
    "Detay" bağlantısı (absolute, `/personel/<slug>`; liste sayfasının kendi
    `/personel/akademik` linki hariç tutulur).
    """
    soup = BeautifulSoup(html, "html.parser")
    cards = soup.select("div.person")
    people: list[PersonRef] = []

    for card in cards:
        name_el = card.select_one(".perName")
        if name_el is None:
            continue
        name = name_el.get_text(strip=True)
        title_el = card.select_one(".perTitle")
        # K-52: unvan ayrı kolona; site formunu ("Doktor Öğretim Üyesi") kanonik
        # kısa forma ("Dr. Öğr. Üyesi") indir. Ad, unvanla BİRLEŞTİRİLMEZ.
        title = canonical_title(title_el.get_text(strip=True)) if title_el else None

        detail_url: str | None = None
        for a in card.select("a[href]"):
            href = a.get("href", "").strip()
            if "/personel/" not in href:
                continue
            if href.rstrip("/").endswith("/akademik"):
                continue          # liste sayfasının kendisine dönen link
            detail_url = href
            break

        if not name or not detail_url:
            continue
        people.append(PersonRef(full_name=name, detail_url=detail_url, title=title))

    if not people:
        # Sayfa geldiyse ama kimse ayrıştırılamadıysa: site yapısı değişmiştir.
        raise ScrapeError(
            f"Liste sayfasından 0 kişi ayrıştırıldı ({len(cards)} kart, "
            f"{len(html)} bayt HTML) — site yapısı değişmiş olabilir."
        )
    return people


def _bolum_segment(path: str) -> str | None:
    """"Fakülte / Bölüm / Anabilim Dalı" yolundan ortadaki Bölüm'ü döndürür.

    Örn. "Mühendislik Fakültesi / İnşaat Mühendisliği Bölümü / ... Anabilim
    Dalı" → "İnşaat Mühendisliği". Sondaki " Bölümü" eki bölüm eşlemesini
    (departments.name) bozmasın diye atılır.
    """
    parts = [p.strip() for p in path.split("/") if p.strip()]
    if len(parts) >= 2:
        seg = parts[1]
    elif parts:
        seg = parts[0]
    else:
        return None
    suffix = " Bölümü"
    if seg.endswith(suffix):
        seg = seg[: -len(suffix)].strip()
    return seg or None


def parse_detail(html: str) -> PersonDetail:
    """Detay HTML'inden e-posta + Görev/Kadro Birimi'ni çıkarır.

    Bölüm alanları `span#...lbl_kadro` içindeki `.ls_item` bloklarındadır; her
    blokta `<h4>` etiket (Görev Birimi / Kadro Birimi) ve `.div_litem` değer
    bulunur. Selector özellikle lbl_kadro'yu hedefler — aynı sayfadaki
    "Öğrenim Bilgileri" bloğu da "Bölümü" metni taşır, ona takılmamalı.
    """
    soup = BeautifulSoup(html, "html.parser")

    email = None
    email_el = soup.select_one("[itemprop='email']")
    if email_el:
        email = email_el.get_text(strip=True) or None

    duty_unit = cadre_unit = None
    kadro = soup.select_one("span[id*='lbl_kadro']")
    if kadro:
        for item in kadro.select(".ls_item"):
            label_el = item.find("h4")
            value_el = item.select_one(".div_litem")
            if not label_el or not value_el:
                continue
            label = label_el.get_text(strip=True)
            value = _bolum_segment(value_el.get_text(strip=True))
            if label == "Görev Birimi":
                duty_unit = value
            elif label == "Kadro Birimi":
                cadre_unit = value

    return PersonDetail(duty_unit=duty_unit, cadre_unit=cadre_unit, email=email)


# ----------------------------------------------------------------------------
# Ağ katmanı (endpoint buradan çağırır; testler saf ayrıştırıcıyı monkeypatch'ler)
# ----------------------------------------------------------------------------

def _get(url: str) -> str:
    try:
        resp = httpx.get(
            url, headers=_HEADERS, timeout=_TIMEOUT, follow_redirects=True
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise ScrapeError(f"Sayfa çekilemedi ({url}): {exc}") from exc
    return resp.text


def fetch_list(url: str) -> list[PersonRef]:
    return parse_list(_get(url))


def fetch_detail(url: str) -> PersonDetail:
    return parse_detail(_get(url))


def fetch_details_bulk(
    urls: list[str], max_workers: int = 8
) -> dict[str, PersonDetail]:
    """Detay sayfalarını SINIRLI eşzamanlılıkla çeker: {url: PersonDetail}.

    İş ağ-bekleme ağırlıklı (I/O-bound); paralel istek her sayfayı hızlandırmaz
    ama beklemeleri üst üste bindirerek toplam süreyi ~max_workers kat kısaltır.
    Havuz küçük tutulur — kaynak siteyi bombalamamak için (paralel ama kibar).

    Tek sayfa patlarsa o kişi bölümsüz/e-postasız döner; tüm import düşmez.
    `fetch_detail` modül düzeyinde çağrılır → testler onu monkeypatch'leyebilir.
    """
    unique = list(dict.fromkeys(urls))     # sırayı koru, tekrarları at
    if not unique:
        return {}

    def _one(url: str) -> tuple[str, PersonDetail]:
        try:
            return url, fetch_detail(url)
        except ScrapeError:
            return url, PersonDetail(duty_unit=None, cadre_unit=None, email=None)

    workers = max(1, min(max_workers, len(unique)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return {url: detail for url, detail in pool.map(_one, unique)}
