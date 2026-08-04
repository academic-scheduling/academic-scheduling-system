"""Bologna bilgi paketi ders import'u (WP7).

Kaynak: obs.mu.edu.tr/oibs/bologna/progCourses.aspx?lang=tr&curSunit=<ID>
Sunucu-render HTML tablo (grdBolognaDersler), yariyil yariyil dersler.

Yalniz DERS bilgisi cikarilir: kod, ad, T+U+L, AKTS, zorunlu/secmeli, yariyil ->
yil + donem. Hoca/sube ACILMAZ (Bologna'da hoca yok; subeler sonra elle
eklenir). Ogretim sekli okunmaz (Course modelinde karsiligi yok). AKTS (K-55)
courses.ects'e yazilir; parse edilemezse None (kolon nullable).

parse_courses saf fonksiyondur (ag bilmez) — kaydedilmis HTML ile test edilir.
"""

import re
from dataclasses import dataclass

import httpx
from bs4 import BeautifulSoup

BOLOGNA_URL = "https://obs.mu.edu.tr/oibs/bologna/progCourses.aspx"

# "3.Yarıyıl Ders Planı" -> 3. Bosluk/nokta varyasyonlarina toleransli.
_YARIYIL_RE = re.compile(r"(\d+)\s*\.\s*Yarıyıl")
# "3+0+2" -> (3, 0, 2). Ders satirini tanimanin da olcutu (bu kalip yoksa ders degil).
_TUL_RE = re.compile(r"^\s*(\d+)\s*\+\s*(\d+)\s*\+\s*(\d+)\s*$")


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
        ))
    return courses
