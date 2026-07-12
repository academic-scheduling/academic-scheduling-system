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
    can_manage_classrooms=True
)
db.add(admin)
db.commit()
print("Admin user created successfully.")
db.close()