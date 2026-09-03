"""Fakülte bölüm + öğretim üyesi seed'i (K-50/K-52).

Amaç: veritabanı sıfırlansa da bir fakülte kadrosunu tek komutla geri yüklemek.
Ayrıca kısıtlı yetki testleri için TEST ALT HESAPLARI ekler.

VERİ NEREDEN GELİR (K-85)
-------------------------
Kadro verisi bu dosyanın İÇİNDE değil, ayrı bir JSON dosyasında durur ve iki
kaynaktan biri seçilir:

  1. seed_local/lecturers.json   — varsa BU kullanılır. .gitignore'dadır,
     yani depoya asla girmez ve `git pull` onu silmez. Ekibin kendi gerçek
     kadro verisi burada yaşar.
  2. seed_data/lecturers_ornek.json — yereli yoksa bu kullanılır. Depoda
     bulunur, içindeki kişiler tamamen kurgusaldır.

Bu ayrımın sebebi: depo herkese açık. Gerçek kişilerin adı ve kurumsal
e-posta adresi koda gömülü olursa, deponun klonlayan herkes o listeyi
indirmiş olur — script hiç çalıştırılmasa bile. Veri kodun içindeyken bunu
engellemenin yolu yoktu; dışarı alınınca sorun kendiliğinden kalktı.

Örnek veri gerçeğin YAPISINI taklit eder (aynı kayıt sayısı, aynı unvan ve
bölüm dağılımı), böylece kurgusal veriyle çalışan biri de gerçekçi büyüklükte
bir fakülte görür.

Çalıştırma:  python seed_engineering.py
İdempotent: var olan kayıtları (kod / normalized_name / e-posta) atlar.
"""
import json
from pathlib import Path

from app.db import SessionLocal
from app.models import (
    Department, DepartmentMembership, Lecturer, User, UserRole, UserStatus,
    Workgroup,
)
from app.security import hash_password

_BURASI = Path(__file__).resolve().parent
_YEREL = _BURASI / "seed_local" / "lecturers.json"
_ORNEK = _BURASI / "seed_data" / "lecturers_ornek.json"


def _kadroyu_yukle() -> tuple[list[dict], list[dict], str]:
    """Yerel veri varsa onu, yoksa depodaki kurgusal örneği döner.

    Hangisinin kullanıldığı ekrana yazılır: sessizce örnek veriyle çalışıp
    "gerçek kadro nerede" diye aranmak, sessizce gerçek veriyle çalışmaktan
    daha az tehlikeli ama yine de vakit kaybettirir.
    """
    kaynak = _YEREL if _YEREL.is_file() else _ORNEK
    if not kaynak.is_file():
        raise SystemExit(
            f"Kadro verisi bulunamadı. Beklenen: {_YEREL} veya {_ORNEK}"
        )
    veri = json.loads(kaynak.read_text(encoding="utf-8"))
    etiket = "YEREL (gerçek)" if kaynak == _YEREL else "ÖRNEK (kurgusal)"
    return veri["departments"], veri["lecturers"], etiket


DEPARTMENTS, LECTURERS, _KAYNAK_ETIKETI = _kadroyu_yukle()


TEST_ACCOUNTS = [
    {
        # Kisitli yetki testleri: yalniz derslik + ogretim uyesi.
        "name": "Alt Hesap (Test)",
        "email": "althesap@muh.example.edu.tr",
        "password": "test1234",
        "departments": [],
        "flags": {
            "can_manage_classrooms": True,
            "can_manage_lecturers": True,
        },
    },
    {
        # Program HAZIRLAYAN: taslak acar, duzenler, onaya gonderir.
        "name": "Program Sorumlusu (Test)",
        "email": "program@muh.example.edu.tr",
        "password": "test1234",
        "departments": "all",
        "flags": {
            "can_manage_courses": True,
            "can_manage_weekly": True,
            "can_manage_exams": True,
        },
    },
    {
        # ONAYLAYAN: baskasinin taslagini inceleyip yayina alir.
        # Kendi talebini onaylayamaz -- bu yuzden ayri bir hesap.
        "name": "Onay Yetkilisi (Test)",
        "email": "onay@muh.example.edu.tr",
        "password": "test1234",
        "departments": "all",
        "flags": {
            "can_approve_schedule": True,
        },
    },
]


def seed_engineering():
    print(f"Kadro kaynağı: {_KAYNAK_ETIKETI} — {len(LECTURERS)} hoca, {len(DEPARTMENTS)} bölüm")
    db = SessionLocal()
    try:
        wg = db.query(Workgroup).first()
        if wg is None:
            wg = Workgroup(name="Mühendislik Fakültesi",
                           allowed_email_domain="muh.example.edu.tr")
            db.add(wg)
            db.flush()
        admin = db.query(User).filter(User.role == UserRole.ADMIN).first()
        if admin is not None and wg.created_by is None:
            wg.created_by = admin.id

        # --- Bölümler (koda göre idempotent) ---
        dep_by_code = {}
        for d in DEPARTMENTS:
            existing = db.query(Department).filter(Department.code == d["code"]).first()
            if existing is None:
                existing = Department(workgroup_id=wg.id, code=d["code"], name=d["name"])
                db.add(existing)
                db.flush()
                print(f"Bölüm eklendi: {d['code']} — {d['name']}")
            dep_by_code[d["code"]] = existing

        # --- Öğretim üyeleri (normalized_name'e göre idempotent) ---
        eklendi = 0
        for l in LECTURERS:
            clash = db.query(Lecturer).filter(
                Lecturer.workgroup_id == wg.id,
                Lecturer.normalized_name == l["normalized_name"],
            ).first()
            if clash is not None:
                continue
            dep = dep_by_code.get(l["dept_code"]) if l["dept_code"] else None
            db.add(Lecturer(
                workgroup_id=wg.id,
                full_name=l["full_name"],
                title=l["title"],
                normalized_name=l["normalized_name"],
                email=l["email"],
                is_external=l["is_external"],
                source=l["source"],
                department_id=dep.id if dep else None,
                duty_unit=l["duty_unit"],
                cadre_unit=l["cadre_unit"],
            ))
            eklendi += 1
        print(f"Öğretim üyesi: {eklendi} yeni eklendi, {len(LECTURERS) - eklendi} zaten vardı.")

        # --- Test hesapları (e-postaya göre idempotent) ---
        for acc in TEST_ACCOUNTS:
            if db.query(User).filter(User.email == acc["email"]).first() is not None:
                continue
            u = User(
                workgroup_id=wg.id,
                name=acc["name"],
                email=acc["email"],
                password_hash=hash_password(acc["password"]),
                role=UserRole.SUB_ACCOUNT,
                status=UserStatus.ACTIVE,
                **acc["flags"],
            )
            db.add(u)
            db.flush()
            if acc["departments"] == "all":
                for dep in dep_by_code.values():
                    db.add(DepartmentMembership(user_id=u.id, department_id=dep.id))
            print(f"Hesap eklendi: {acc['email']} / {acc['password']}"
                  f"  ({', '.join(acc['flags']) or 'yetkisiz'})")

        print("\nK-59: öz-onay yasak — program@ hazırlar, onay@ yayına alır.")

        db.commit()
        print("seed_engineering tamam.")
    finally:
        db.close()


if __name__ == "__main__":
    seed_engineering()
