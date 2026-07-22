from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.deps import get_db, require_admin
from app.config import settings
from app.models import (
    User, UserRole, UserStatus,
    Department, DepartmentMembership, InvitationToken,
)
from app.schemas import (
    InviteRequest, InviteResponse, MessageResponse, UserListItem, UserUpdate,
)
from app.audit import log_action
from app.security import generate_invitation_token, hash_token
from app.mailer import send_invitation_email


router = APIRouter(prefix="/users", tags=["users"])


# --- İzole domain kontrolü (ileride global<->workgroup geçişi burada) ---
def check_email_domain(email: str) -> bool:
    domains = [d.strip().lower() for d in settings.allowed_email_domains.split(",") if d.strip()]
    if "*" in domains:
        return True
    domain = email.split("@")[-1].lower()
    return domain in domains

def _create_and_store_token(db: Session, user_id: int) -> str:
    """Yeni token üretir, hash'ini DB'ye yazar, ham token'ı döner."""
    raw = generate_invitation_token()
    invite = InvitationToken(
        user_id=user_id,
        token_hash=hash_token(raw),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=settings.invitation_expire_hours),
    )
    db.add(invite)
    return raw

@router.post("/invite", response_model=InviteResponse, status_code=status.HTTP_201_CREATED)
def invite_user(
    payload: InviteRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    # 1. Domain
    if not check_email_domain(payload.email):
        raise HTTPException(status_code=400, detail="E-posta izinli domainde değil")

    # 2. E-posta benzersizliği
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=409, detail="Bu e-posta zaten kayıtlı")

    # 3. Bölüm kontrolü + workgroup izolasyonu
    if payload.department_ids:
        wanted = set(payload.department_ids)
        found = db.query(Department).filter(
            Department.id.in_(wanted),
            Department.workgroup_id == admin.workgroup_id,
        ).all()
        if len(found) != len(wanted):
            raise HTTPException(status_code=400, detail="Geçersiz bölüm seçimi")

    # 4. PENDING kullanıcı
    # K-25: ADMIN davet edildiyse bayraklar YOK SAYILIR — rol muafiyeti zaten
    # her yetkiyi veriyor; DB'ye true yazmak yanıltıcı bir ikinci gerçek üretir
    # (rol düşürülürse sessizce yetkili kalırdı).
    is_admin = payload.role == UserRole.ADMIN
    user = User(
        workgroup_id=admin.workgroup_id,
        name=payload.name,
        email=payload.email,
        role=payload.role,
        status=UserStatus.PENDING,
        password_hash=None,
        can_manage_courses=False if is_admin else payload.can_manage_courses,
        can_manage_weekly=False if is_admin else payload.can_manage_weekly,
        can_manage_exams=False if is_admin else payload.can_manage_exams,
        can_manage_classrooms=False if is_admin else payload.can_manage_classrooms,
        can_manage_lecturers=False if is_admin else payload.can_manage_lecturers,
    )
    db.add(user)
    db.flush()  # user.id'yi almak için

    # 5. Membership satırları
    for dept_id in set(payload.department_ids):
        db.add(DepartmentMembership(user_id=user.id, department_id=dept_id))

    # 6. Token
    raw_token = _create_and_store_token(db, user.id)

    # 7. Commit, sonra mail
    db.commit()
    db.refresh(user)
    send_invitation_email(user.email, user.name, raw_token)

    return user


@router.post("/{user_id}/resend-invitation", response_model=MessageResponse)
def resend_invitation(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = db.get(User, user_id)
    if user is None or user.workgroup_id != admin.workgroup_id:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    if user.status != UserStatus.PENDING:
        raise HTTPException(status_code=400, detail="Yalnızca bekleyen davetler yeniden gönderilebilir")

    # Eski kullanılmamış token'ları geçersiz kıl
    now = datetime.now(timezone.utc)
    for tok in user.invitation_tokens:
        if tok.used_at is None:
            tok.used_at = now

    raw_token = _create_and_store_token(db, user.id)
    db.commit()
    send_invitation_email(user.email, user.name, raw_token)

    return MessageResponse(message="Davet yeniden gönderildi")


@router.get("", response_model=list[UserListItem])
def list_users(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    users = db.query(User).filter(User.workgroup_id == admin.workgroup_id).all()
    return users


def _get_owned_user(db: Session, admin: User, user_id: int) -> User:
    """Workgroup dışındaki kullanıcı YOK sayılır (404, 403 değil).

    403 verilseydi "bu id'de bir kullanıcı var ama senin değil" bilgisi
    sızardı; brief §6.3 URL id değiştirerek başka workgroup'a erişmeyi
    yasaklıyor, varlığını doğrulamak da bir sızıntıdır.
    """
    user = db.get(User, user_id)
    if user is None or user.workgroup_id != admin.workgroup_id:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    return user


@router.patch("/{user_id}", response_model=UserListItem)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Rol, bölüm ataması, yetenek bayrakları ve erişim durumu (K-34).

    Kendi rolünü/durumunu değiştirmek yasaktır: admin kendini DISABLED yapar
    ya da SUB_ACCOUNT'a düşürürse geri dönüşü olmayan biçimde kilitlenir.
    Bu kilit aynı zamanda "son admin" sorununu da çözer — çağıran ACTIVE bir
    admin olduğuna ve kendini değiştiremediğine göre, işlem sonrası
    workgroup'ta her zaman en az bir aktif admin kalır.
    """
    user = _get_owned_user(db, admin, user_id)
    veri = payload.model_dump(exclude_unset=True)

    if user.id == admin.id and ("role" in veri or "status" in veri):
        raise HTTPException(
            status_code=400,
            detail="Kendi rolünüzü veya erişim durumunuzu değiştiremezsiniz. "
                   "Bunu başka bir admin yapmalı.",
        )

    if "name" in veri:
        user.name = veri["name"]
    if "status" in veri:
        user.status = veri["status"]

    # Rol ve bayraklar birlikte değerlendirilir: ADMIN'de bayraklar YOK SAYILIR
    # (K-25). Önce rolü belirle, sonra bayrakları ona göre uygula — sıra önemli,
    # aynı istekte hem rol hem bayrak gelebilir.
    yeni_rol = veri.get("role", user.role)
    if "role" in veri:
        user.role = yeni_rol

    for bayrak in ("can_manage_courses", "can_manage_weekly", "can_manage_exams",
                   "can_manage_classrooms", "can_manage_lecturers"):
        if yeni_rol == UserRole.ADMIN:
            # Admin'e çıkarılan hesapta bayraklar false'a çekilir: rol muafiyeti
            # zaten her yetkiyi veriyor. true yazılsaydı, rol sonradan
            # düşürüldüğünde hesap sessizce yetkili kalırdı.
            setattr(user, bayrak, False)
        elif bayrak in veri:
            setattr(user, bayrak, veri[bayrak])

    if "department_ids" in veri:
        # Üyelikler TOPLU değiştirilir: gönderilen liste yeni gerçektir.
        # Tek tek ekle/çıkar uçları olsaydı istemci iki isteği yarıda bırakıp
        # tutarsız bir ara duruma düşürebilirdi.
        db.query(DepartmentMembership).filter(
            DepartmentMembership.user_id == user.id
        ).delete(synchronize_session=False)

        istenen = set(veri["department_ids"])
        if istenen:
            bulunan = db.query(Department).filter(
                Department.id.in_(istenen),
                Department.workgroup_id == admin.workgroup_id,
            ).count()
            if bulunan != len(istenen):
                raise HTTPException(status_code=400, detail="Geçersiz bölüm seçimi")
            for dep_id in istenen:
                db.add(DepartmentMembership(user_id=user.id, department_id=dep_id))

    log_action(db, admin, "UPDATE", "user", user.id)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Yalnız PENDING hesabı siler (K-34).

    Veritabanı bu silmeyi ENGELLEMEZ: `audit_logs.user_id`, `exams.created_by`
    ve `weekly_schedule_entries.created_by` FK'leri ON DELETE SET NULL.
    Yani kullanılmış bir hesabı silmek hata vermez, sessizce o kişinin yaptığı
    her işlemin "kim" bilgisini siler — brief §6.3'ün log şartını geriye dönük
    çökertir. Kısıt veritabanında olmadığı için engel burada duruyor.

    PENDING hesap hiç giriş yapmamıştır, hiçbir kaydın faili değildir;
    CASCADE'in götürdüğü tek şey kendi davet token'ı ve bölüm atamasıdır.
    """
    user = _get_owned_user(db, admin, user_id)

    if user.status != UserStatus.PENDING:
        raise HTTPException(
            status_code=409,
            detail="Kullanılmış hesap silinemez: işlem kayıtlarındaki izi "
                   "kaybolur. Erişimi kapatın (status: DISABLED).",
        )

    log_action(db, admin, "DELETE", "user", user.id)
    db.delete(user)
    db.commit()
