"""Hoca adi normalizasyonu (K-08).

normalized_name, esletirme ANAHTARIDIR: kucuk harf, unvansiz, tek bosluk.
"Doç. Dr. Ayşe Kaya" ve "Ayşe KAYA" ayni kisi olarak eslesmeli; aksi halde
hoca cakisma tespiti (W2/E3) sessizce delinir.
"""

# Unvan parcalari: noktalar ayraca cevrildikten sonra tek tek dusurulur.
# "Doç. Dr." -> "doç dr" -> iki token da listede -> atilir.
#
# Hem KISALTMA hem TAM-KELIME formlari listede: fakulte web import'u (K-50)
# unvani "Doktor Ogretim Uyesi" / "Arastirma Gorevlisi" gibi acik yazar; elle
# girilen kayit ise "Dr. Ogr. Uyesi" kisaltmasini kullanir. Ikisi ayni kisiyi
# gostermeli, yoksa import mukerrer kayit uretir ve W2/E3 hoca cakismasi delinir.
# Bu kelimeler Turkce kisi adlarinda gecmez; ad token'ini yanlislikla dusurmezler.
TITLE_TOKENS = {
    "prof", "doç", "doc", "dr", "öğr", "ogr", "gör", "gor",
    "arş", "ars", "uzm", "yrd", "üyesi", "uyesi",
    # tam kelime formlari (site acik yazar)
    "doktor", "öğretim", "ogretim", "görevlisi", "gorevlisi",
    "araştırma", "arastirma", "profesör", "profesor", "doçent", "docent",
}


def turkish_lower(text: str) -> str:
    """Python'un lower()'i Turkce I/İ'yi yanlis cevirir; once elle duzelt.

    "YILDIRIM".lower() -> "yildirim" (yanlis, "yıldırım" olmali)
    "İsmail".lower()   -> "i̇smail" (bitisik nokta artigi birakir)
    """
    return text.replace("İ", "i").replace("I", "ı").lower()


def normalize_lecturer_name(full_name: str) -> str:
    cleaned = turkish_lower(full_name)
    cleaned = cleaned.replace(".", " ").replace(",", " ")
    tokens = [t for t in cleaned.split() if t not in TITLE_TOKENS]
    return " ".join(tokens)


# ----------------------------------------------------------------------------
# Unvan (title) — ad'dan AYRI alan (K-52)
# ----------------------------------------------------------------------------
# Unvan artik full_name'in icine gomulu DEGIL, kendi kolonunda tutulur
# (models.Lecturer.title). Bu blok TEK kaynaktir: hem web import (site'in yazdigi
# "Doktor Ogretim Uyesi" gibi acik formu kanonige eşler) hem de eski kayitlari
# ayiran migration bunu kullanir. Kanonik form = ekranda gosterilen kisa form.

# Kanonik unvanlar, ekleme formundaki listeyle ayni (frontend TITLES ile eş).
# Ada gore siralama normalized_name'i kullandigi icin unvan sadece GORUNTU.
CANONICAL_TITLES: list[str] = [
    "Prof. Dr.", "Prof.", "Doç. Dr.", "Doç.", "Dr. Öğr. Üyesi",
    "Öğr. Gör. Dr.", "Öğr. Gör.", "Arş. Gör. Dr.", "Arş. Gör.",
    "Uzman", "Dr.",
]

# ASCII / kisaltma varyantlarini kanonik (Turkce, diakritikli) token'a cevirir.
# Site ve elle giris bazen "Doc"/"ogr"/"uyesi" yazar; tek forma indiririz.
_TOKEN_ALIAS: dict[str, str] = {
    "doc": "doç", "docent": "doçent",
    "ogr": "öğr", "ogretim": "öğretim",
    "gor": "gör", "gorevlisi": "görevlisi",
    "ars": "arş", "arastirma": "araştırma",
    "uyesi": "üyesi", "profesor": "profesör",
}

# Token KUMESI → kanonik unvan. Kume kullanilir (siralamadan bagimsiz): site
# "Doktor Öğretim Üyesi" (acik), elle giris "Dr. Öğr. Üyesi" (kisa) aynı sonuca
# duser. Her iki form da burada. "yrd doç dr" (eski Yrd. Doç.) → Dr. Öğr. Üyesi.
_TITLE_CANON: dict[frozenset[str], str] = {
    frozenset({"prof", "dr"}): "Prof. Dr.",
    frozenset({"profesör", "doktor"}): "Prof. Dr.",
    frozenset({"prof"}): "Prof.",
    frozenset({"profesör"}): "Prof.",
    frozenset({"doç", "dr"}): "Doç. Dr.",
    frozenset({"doçent", "doktor"}): "Doç. Dr.",
    frozenset({"doç"}): "Doç.",
    frozenset({"doçent"}): "Doç.",
    frozenset({"dr", "öğr", "üyesi"}): "Dr. Öğr. Üyesi",
    frozenset({"doktor", "öğretim", "üyesi"}): "Dr. Öğr. Üyesi",
    frozenset({"yrd", "doç", "dr"}): "Dr. Öğr. Üyesi",
    frozenset({"öğr", "gör", "dr"}): "Öğr. Gör. Dr.",
    frozenset({"öğretim", "görevlisi", "doktor"}): "Öğr. Gör. Dr.",
    frozenset({"öğr", "gör"}): "Öğr. Gör.",
    frozenset({"öğretim", "görevlisi"}): "Öğr. Gör.",
    frozenset({"arş", "gör", "dr"}): "Arş. Gör. Dr.",
    frozenset({"araştırma", "görevlisi", "doktor"}): "Arş. Gör. Dr.",
    frozenset({"arş", "gör"}): "Arş. Gör.",
    frozenset({"araştırma", "görevlisi"}): "Arş. Gör.",
    frozenset({"uzman"}): "Uzman",
    frozenset({"uzm"}): "Uzman",
    frozenset({"dr"}): "Dr.",
    frozenset({"doktor"}): "Dr.",
}

# Bir token'in unvan kelimesi olup olmadigini anlamak icin: haritadaki tum
# diakritikli kelimeler (alias'lar cevrildikten SONRA bunlara karsi bakilir).
_TITLE_WORDS: frozenset[str] = frozenset().union(*_TITLE_CANON.keys())


def _title_key(token: str) -> str:
    """Ham token → kanonik (kucuk harf + alias cevrilmis) karsilastirma anahtari."""
    low = turkish_lower(token)
    return _TOKEN_ALIAS.get(low, low)


def canonical_title(raw: str | None) -> str | None:
    """Serbest unvan metnini kanonik kisa forma eşler ("Prof.Dr."→"Prof. Dr.").

    Web import kullanir: site "Doktor Öğretim Üyesi" yazar, biz "Dr. Öğr. Üyesi"
    saklariz. Taninmayan bir unvan gelirse ham hali korunur (bilgi kaybolmasin;
    ekran herhangi bir metni gosterebilir, sadece ekleme formundaki Select'te
    hazir secenek olmaz). Bos/unvansiz → None.
    """
    if not raw:
        return None
    spaced = raw.replace(".", " ").replace(",", " ")
    keys = [_title_key(t) for t in spaced.split()]
    keys = [k for k in keys if k in _TITLE_WORDS]
    if not keys:
        return raw.strip() or None
    return _TITLE_CANON.get(frozenset(keys), raw.strip())


def split_title(full_name: str) -> tuple[str | None, str]:
    """"Doç. Dr. Ayşe Kaya" → ("Doç. Dr.", "Ayşe Kaya"). Unvan yoksa (None, ad).

    Bastaki unvan kelimeleri (nokta ayraca cevrilmis) greedy tuketilir, kalan
    ad'dir. K-52 migration'i eski birlesik full_name'leri bununla ayirir. Bu
    kelimeler Turkce kisi adinda gecmez → ad token'i yanlislikla tuketilmez.
    Taninan kelime var ama kombinasyonu haritada yoksa (guvenli taraf) bolmez.
    """
    spaced = full_name.replace(".", " ").replace(",", " ")
    raw_tokens = spaced.split()
    consumed: list[str] = []
    for tok in raw_tokens:
        key = _title_key(tok)
        if key in _TITLE_WORDS:
            consumed.append(key)
        else:
            break
    if not consumed:
        return None, full_name.strip()
    title = _TITLE_CANON.get(frozenset(consumed))
    name = " ".join(raw_tokens[len(consumed):]).strip()
    if title is None or not name:      # bilinmeyen kombinasyon ya da ad bos: bolme
        return None, full_name.strip()
    return title, name