"""Hoca adi normalizasyonu (K-08).

normalized_name, esletirme ANAHTARIDIR: kucuk harf, unvansiz, tek bosluk.
"Doç. Dr. Ayşe Kaya" ve "Ayşe KAYA" ayni kisi olarak eslesmeli; aksi halde
hoca cakisma tespiti (W2/E3) sessizce delinir.
"""

# Unvan parcalari: noktalar ayraca cevrildikten sonra tek tek dusurulur.
# "Doç. Dr." -> "doç dr" -> iki token da listede -> atilir.
TITLE_TOKENS = {
    "prof", "doç", "doc", "dr", "öğr", "ogr", "gör", "gor",
    "arş", "ars", "uzm", "yrd", "üyesi", "uyesi",
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