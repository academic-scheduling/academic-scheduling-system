"""Bologna bilgi paketi ders import'u (WP7 · K-64).

Kaynak: obs.mu.edu.tr/oibs/bologna/progCourses.aspx?lang=tr&curSunit=<ID>
Sunucu-render HTML tablo (grdBolognaDersler), yariyil yariyil dersler.

DERS bilgisi liste sayfasindan cikar: kod, ad, T+U+L, AKTS, zorunlu/secmeli,
yariyil -> yil + donem. Ogretim sekli okunmaz (Course modelinde karsiligi yok).
AKTS (K-55) courses.ects'e yazilir; parse edilemezse None (kolon nullable).

K-64 · HOCA/SUBE liste sayfasinda DEGIL, ders DETAY sayfasindadir:
`progCourseDetails.aspx?curCourse=<ID>`. curCourse ID'si liste sayfasinda gomulu
degil — her satirdaki "i" baglantisi bir ASP.NET postback'idir
(`grdBolognaDersler$ctlNN$btnDersAyrinti`) ve ID sunucuda viewstate'ten cozulur.
Zincir: liste GET → gizli alanlar (VIEWSTATE vb.) → satirin event_target'i →
ayni viewstate ile POST → 302 → detay sayfasi → "Dersi Verenler" + vize sayisi.
Tek GET'in viewstate'i tum dersler icin yeniden kullanilir (olculdu).

parse_* fonksiyonlari saftir (ag bilmez) — kaydedilmis HTML ile test edilir.
"""

import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import httpx
from bs4 import BeautifulSoup, NavigableString

from app.normalize import normalize_lecturer_name, split_title

BOLOGNA_URL = "https://obs.mu.edu.tr/oibs/bologna/progCourses.aspx"
# K-50 ile ayni: bazi sunucular UA'siz istegi reddediyor; kaynak kendi
# universitemiz, veri herkese acik.
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; academic-scheduling-import/1.0)"
}
_TIMEOUT = 30.0

# "3.Yarıyıl Ders Planı" -> 3. Bosluk/nokta varyasyonlarina toleransli.
_YARIYIL_RE = re.compile(r"(\d+)\s*\.\s*Yarıyıl")
# "3+0+2" -> (3, 0, 2). Ders satirini tanimanin da olcutu (bu kalip yoksa ders degil).
_TUL_RE = re.compile(r"^\s*(\d+)\s*\+\s*(\d+)\s*\+\s*(\d+)\s*$")
# "i" baglantisinin postback hedefi: __doPostBack('HEDEF','')
_EVENT_TARGET_RE = re.compile(r"__doPostBack\('([^']+)'")


@dataclass
class ParsedInstructor:
    """Detay sayfasindaki "Dersi Verenler"den tek hoca (unvan ad'dan ayrilmis)."""
    raw: str               # "Dr.Öğr.Üyesi BARIŞ İŞÇİ PEMBECİ" (ekranda gosterilir)
    title: str | None      # kanonik unvan, yoksa None
    name: str              # "BARIŞ İŞÇİ PEMBECİ"
    normalized: str        # "barış işçi pembeci" — mevcut hocayla eslestirme anahtari


@dataclass
class CourseDetail:
    """Ders detay sayfasindan cikan sube-ile-ilgili alanlar."""
    instructors: list[ParsedInstructor]
    midterm_count: int | None   # "Ara Sınav" sayisi (1-3), yoksa None


@dataclass
class ParsedCourse:
    """Bologna satirindan cikarilan tek ders (henuz DB'ye yazilmamis)."""
    code: str
    name: str
    year: int
    semester: str          # "FALL" | "SPRING"
    hours_theory: int
    hours_practice: int
    hours_lab: int
    is_elective: bool
    ects: int | None = None      # K-55: AKTS; sutun bos/sayisal degilse None
    # K-64: bu satirin detay sayfasina goturen postback hedefi. None ise "i"
    # baglantisi okunamadi → detay (hoca/vize) cekilemez, ders yine aktarilabilir.
    event_target: str | None = None


def extract_cursunit(url: str) -> str:
    """Yapistirilana URL'den curSunit (bolum kimligi) sayisini cikarir."""
    m = re.search(r"[?&]curSunit=(\d+)", url)
    if not m:
        raise ValueError("URL'de curSunit parametresi bulunamadı")
    return m.group(1)


def fetch_bologna_html(cur_sunit: str) -> str:
    """Bolumun Turkce ders sayfasini ceker. Ag/HTTP hatasi cagirana yansir."""
    r = httpx.get(
        BOLOGNA_URL,
        params={"lang": "tr", "curSunit": cur_sunit},
        timeout=30,
        follow_redirects=True,
    )
    r.raise_for_status()
    return r.text


def parse_courses(html: str) -> list[ParsedCourse]:
    """grdBolognaDersler tablosunu yariyil yariyil gezip dersleri cikarir.

    Satir tipleri: yariyil basligi ("N.Yarıyıl"), sutun basligi ("Ders Kodu"),
    ders satiri, "Toplam AKTS" ve bos satirlar. Yalniz ders satirlari alinir;
    ayirt etme olcutu T+U+L kalibinin (d+d+d) varligi.
    """
    soup = BeautifulSoup(html, "html.parser")
    grid = soup.find(id="grdBolognaDersler")
    if grid is None:
        return []

    courses: list[ParsedCourse] = []
    current_yariyil: int | None = None

    for tr in grid.find_all("tr"):
        cells = [c.get_text(strip=True) for c in tr.find_all(["td", "th"])]
        if not cells:
            continue

        # Yariyil basligi herhangi bir hucrede olabilir.
        m = _YARIYIL_RE.search(" ".join(cells))
        if m:
            current_yariyil = int(m.group(1))
            continue

        # Ders satiri: kod dolu + T+U+L kalibina uyan hucre. Yariyil belli olmali.
        if current_yariyil is None or len(cells) < 5:
            continue
        code = cells[1].strip()
        tul = _TUL_RE.match(cells[3])
        if not code or code == "Ders Kodu" or tul is None:
            continue  # sutun basligi / Toplam AKTS / bos satir

        # K-55: AKTS cells[5]'te. Bazi satirlarda bos ya da sayisal olmayabilir
        # ("-", " ") → None birak (kolon nullable). Ondalik gelmez, MU tam sayi verir.
        ects_raw = cells[5].strip() if len(cells) > 5 else ""
        ects = int(ects_raw) if ects_raw.isdigit() else None

        # K-64: satirin "i" baglantisindan detay postback hedefini oku. Bulunmazsa
        # None (detay cekilemez ama ders yine aktarilabilir).
        info_link = tr.find("a", href=_EVENT_TARGET_RE)
        tm = _EVENT_TARGET_RE.search(info_link["href"]) if info_link else None
        event_target = tm.group(1) if tm else None

        courses.append(ParsedCourse(
            code=code,
            name=cells[2].strip(),
            year=(current_yariyil + 1) // 2,
            semester="FALL" if current_yariyil % 2 == 1 else "SPRING",
            hours_theory=int(tul.group(1)),
            hours_practice=int(tul.group(2)),
            hours_lab=int(tul.group(3)),
            is_elective=(cells[4].strip() == "Seçmeli"),
            ects=ects,
            event_target=event_target,
        ))
    return courses


# --------------------------------------------------------------------------
# K-64 · Detay sayfasi (hoca + vize sayisi) — postback zinciri
# --------------------------------------------------------------------------

def parse_hidden_fields(html: str) -> dict[str, str]:
    """Liste sayfasindaki ASP.NET gizli alanlari (VIEWSTATE vb.) toplar.

    Postback bunlari geri yollamak zorundadir; aksi halde sunucu istegi
    reddeder. Ayni GET'in alanlari tum dersler icin yeniden kullanilir.
    """
    soup = BeautifulSoup(html, "html.parser")
    fields: dict[str, str] = {}
    for inp in soup.select("input[type=hidden][name]"):
        fields[inp["name"]] = inp.get("value", "")
    return fields


def _parse_instructors(soup: BeautifulSoup) -> list[ParsedInstructor]:
    """"Dersi Verenler" degerini cikarir: <br> ile ayrilmis her hoca ayri.

    Deger span'i `dlDers_DERS_VERENLabel_0` (baslik span'i `...Labelh_0` HARIC —
    id'de "Label_" alt dizisi yalniz deger span'inda gecer). Her satir
    `<Unvan> <Ad>`; split_title unvani ayirir, normalize esletirme anahtarini
    verir. "Yok"/bos satirlar atlanir (hoca girilmemis).
    """
    span = soup.find("span", id=re.compile(r"DERS_VERENLabel_\d+$"))
    if span is None:
        return []
    # <br>'ler dogal metin-dugumu sinirlaridir; NavigableString parcalarini al.
    parts = [
        str(node).strip()
        for node in span.children
        if isinstance(node, NavigableString) and str(node).strip()
    ]
    instructors: list[ParsedInstructor] = []
    for raw in parts:
        if raw.casefold() in {"yok", "-"}:
            continue
        title, name = split_title(raw)
        name = name.strip()
        if not name:
            continue
        instructors.append(ParsedInstructor(
            raw=raw, title=title, name=name,
            normalized=normalize_lecturer_name(name),
        ))
    return instructors


def _parse_midterm_count(soup: BeautifulSoup) -> int | None:
    """"Değerlendirme Ölçütleri" (grd_degerlendirme) tablosundan vize sayisi.

    Ilk hucresi TAM "Ara Sınav" olan satir aranir. Cogul "Ara Sınavlar" (is-yuku
    tablosu) ve hafta-konusu satirlari bu esitlige uymaz — sadece degerlendirme
    satiri gecer. Sayisi ikinci hucrededir; K-46 geregi 1-3'e kirpilir. Yoksa
    None (varsayilan 1 korunur).
    """
    table = soup.find("table", id=re.compile("grd_degerlendirme"))
    if table is None:
        return None
    for tr in table.find_all("tr"):
        cells = [c.get_text(strip=True) for c in tr.find_all("td")]
        if len(cells) >= 2 and cells[0] == "Ara Sınav" and cells[1].isdigit():
            return max(1, min(3, int(cells[1])))
    return None


def parse_detail(html: str) -> CourseDetail:
    """Detay sayfasindan hoca listesi + vize sayisini cikarir (saf)."""
    soup = BeautifulSoup(html, "html.parser")
    return CourseDetail(
        instructors=_parse_instructors(soup),
        midterm_count=_parse_midterm_count(soup),
    )


def fetch_course_detail(
    cur_sunit: str, event_target: str, hidden_fields: dict[str, str]
) -> CourseDetail:
    """Tek dersin detayini postback zinciriyle ceker.

    Liste sayfasina, o satirin event_target'i + gizli alanlarla POST atilir;
    sunucu 302 ile progCourseDetails.aspx?curCourse=<ID>'ye yonlendirir, httpx
    takip eder. Istek basina taze baglanti (K-50 deseni; havuz throttle altinda
    bayatliyordu). Ag/HTTP hatasi cagirana yansir.
    """
    payload = dict(hidden_fields)
    payload["__EVENTTARGET"] = event_target
    payload["__EVENTARGUMENT"] = ""
    r = httpx.post(
        BOLOGNA_URL,
        params={"lang": "tr", "curSunit": cur_sunit},
        data=payload,
        headers=_HEADERS,
        timeout=_TIMEOUT,
        follow_redirects=True,
    )
    r.raise_for_status()
    return parse_detail(r.text)


def fetch_details_bulk(
    cur_sunit: str,
    targets: dict[str, str],
    hidden_fields: dict[str, str],
    max_workers: int = 8,
) -> dict[str, CourseDetail]:
    """Ders detaylarini SINIRLI eszamanlilikla ceker: {event_target: CourseDetail}.

    targets = {ders_kimligi: event_target}; sonuc ayni anahtarla doner. Is ag-
    bekleme agirlikli; paralel istek beklemeleri ust uste bindirir (K-50). Havuz
    kucuk — kaynagi bombalamamak icin. Tek ders patlarsa o ders hocasiz/vizesiz
    doner (bos CourseDetail), tum import DUSMEZ.
    """
    if not targets:
        return {}

    def _one(item: tuple[str, str]) -> tuple[str, CourseDetail]:
        key, target = item
        try:
            return key, fetch_course_detail(cur_sunit, target, hidden_fields)
        except httpx.HTTPError:
            return key, CourseDetail(instructors=[], midterm_count=None)

    workers = max(1, min(max_workers, len(targets)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return dict(pool.map(_one, targets.items()))
