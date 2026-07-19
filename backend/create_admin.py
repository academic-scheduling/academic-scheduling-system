from app.db import SessionLocal
from app.models import User, UserRole, UserStatus, Workgroup
from app.security import hash_password
import sys

db = SessionLocal()
existing = db.query(User).filter(User.email == "admin@muh.example.edu.tr").first()

if existing:
    print("Admin user already exists.")
    sys.exit()

wg = Workgroup(name="Test Fakültesi", allowed_email_domain="muh.example.edu.tr")
db.add(wg)
db.flush()

admin = User(
    workgroup_id=wg.id,
    name="Test Admin",
    email="admin@muh.example.edu.tr",
    password_hash=hash_password("admin1234"),
    role=UserRole.ADMIN,
    status=UserStatus.ACTIVE,
    # K-25: ADMIN'e yetenek bayrağı YAZILMAZ — yetki rol muafiyetinden gelir.
    # Bayrak yazmak yetkinin ikinci bir kaynağını yaratır: rol SUB_ACCOUNT'a
    # düşürülse bile hesap sessizce yetkili kalırdı.
)
db.add(admin)
db.flush()

# Workgroup'u yaratan admin'i işaretle. Bugün kullanılmıyor ama kolon zaten
# şemada var ve NULL bırakmak veriyi eksik bırakmak demek; ayrıca ertelenen
# çoklu workgroup kararında (karar defteri, açık konu 6) sahiplik bu kolondan
# okunacak.
wg.created_by = admin.id
db.commit()
print("Admin user created successfully.")
db.close()