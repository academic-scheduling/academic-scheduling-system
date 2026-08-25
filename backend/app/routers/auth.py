from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.config import settings
from app.deps import get_db, get_current_user
from app.schemas import (
    LoginRequest, TokenResponse, UserPublic,
    CompleteInvitationRequest, InvitationPreview, MessageResponse,
    ForgotPasswordRequest, ResetPasswordRequest, PasswordResetPreview,
)
from app.security import (
    verify_password, create_access_token, hash_password, hash_token,
    generate_invitation_token,
)
from app.mailer import send_password_reset_email
from app.recaptcha import verify_captcha
from app.models import User, UserStatus, InvitationToken, PasswordResetToken
from app.audit import log_action

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if user is None or user.password_hash is None or not verify_password(payload.password, user.password_hash) :
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="E-posta veya şifre hatalı",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Kullanıcı hesabı aktif değil",
        )
    # K-82: once ESKI damgayi previous'a tasi, sonra yenisini yaz. Sira onemli —
    # tersi olsaydi previous da bu oturumu gosterirdi ve kimlik kartindaki
    # "onceki girisiniz" satiri her zaman "az once" derdi.
    #
    # Bu yazma OTURUM ACMANIN parcasidir, audit kaydi degil: log'a satir
    # dusurmuyoruz (her giris bir "islem" olsaydi islem kayitlari girislerle
    # dolar, kimin neyi DEGISTIRDIGI kaybolurdu).
    user.previous_login_at = user.last_login_at
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)

    access_token = create_access_token({"sub": str(user.id)})
    return TokenResponse(access_token=access_token, user=UserPublic.model_validate(user))

@router.get("/me", response_model=UserPublic)
def get_current_user_info(current_user: User = Depends(get_current_user)):
    return UserPublic.model_validate(current_user)

@router.post("/refresh", response_model=TokenResponse)
def refresh_token(current_user: User = Depends(get_current_user)):
    """Oturum uzatma (K-47): geçerli token'ı olan AKTİF kullanıcıya yeni bir
    60 dk'lık token verir.

    get_current_user zaten her istekte `status == ACTIVE` arar (deps.py) — bu
    yüzden DISABLED edilmiş hesabın elindeki geçerli token burada da 403 alır,
    yani 'uzat' düğmesi kapatılmış bir hesabı diriltemez. Şifre değişimi vb.
    yeni bir claim gerektirmez; sub aynı kalır, yalnız exp ileri taşınır.
    """
    access_token = create_access_token({"sub": str(current_user.id)})
    return TokenResponse(access_token=access_token, user=UserPublic.model_validate(current_user))

def _resolve_invitation(db: Session, raw_token: str) -> InvitationToken:
    """Ham token'ı çözer; geçersiz/kullanılmış/süresi dolmuş ise 400 fırlatır.

    Token'ı TÜKETMEZ — used_at'i mühürleyen tek yer complete_invitation'dır (K-24).
    Üç hata da 400: 404 verilse token'ın varlığı/yokluğu ayırt edilirdi.
    """
    # 1. Ham token'ı hash'le, DB'de ara
    invite = db.query(InvitationToken).filter(
        InvitationToken.token_hash == hash_token(raw_token)
    ).first()
    if invite is None:
        raise HTTPException(status_code=400, detail="Geçersiz davet bağlantısı")

    # 2. Daha önce kullanılmış mı
    if invite.used_at is not None:
        raise HTTPException(status_code=400, detail="Davet bağlantısı zaten kullanılmış")

    # 3. Süresi dolmuş mu (naive gelirse UTC say — SQLite güvenliği)
    expires = invite.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Davet süresi dolmuş")

    return invite


@router.get("/invitation/{token}", response_model=InvitationPreview)
def preview_invitation(token: str, db: Session = Depends(get_db)):
    """Hesap tamamlama ekranı açılırken token'ı ön-doğrular (K-24, kontrat §1).

    Ölü linkte kullanıcı şifresini yazmadan ÖNCE tam sayfa hata görebilsin diye
    var (wireframe §2). Token'ı tüketmez, hiçbir şey yazmaz.
    """
    invite = _resolve_invitation(db, token)
    return InvitationPreview.model_validate(invite.user)


@router.post("/complete-invitation", response_model=MessageResponse)
def complete_invitation(payload: CompleteInvitationRequest, db: Session = Depends(get_db)):
    # GET ön-doğrulamış olsa bile kontroller burada TEKRAR edilir (K-24): iki
    # çağrı arasında süre dolabilir ya da token başkasınca kullanılabilir.
    invite = _resolve_invitation(db, payload.token)

    # Hesabı aktifleştir + token'ı mühürle
    user = invite.user
    user.password_hash = hash_password(payload.password)
    user.status = UserStatus.ACTIVE
    invite.used_at = datetime.now(timezone.utc)

    # İz (K-37): FAİL kişinin KENDİSİ — davet eden admin değil. Linke tıklayıp
    # şifresini belirleyen odur. log_action'ın JWT'li istek dışında çağrıldığı
    # tek yer burası; fail yine de bir User nesnesi olduğu için imza değişmiyor.
    # İzolasyon bozulmaz: workgroup_id davet anında yazılmıştı (K-35 join'i).
    log_action(db, user, "ACTIVATE", "user", user.id, user)
    db.commit()

    return MessageResponse(message="Hesap aktifleştirildi")


# ==================================================================
# Sifre sifirlama (K-43) — davet akisinin ikizi, ayri token tablosuyla
# ==================================================================

# Her durumda donen tek cevap. Degisken degil sabit: iki cagri yerinde
# farkli yazilirsa metin farki bile "bu e-posta kayitli mi" sorusunu
# cevaplamaya baslar.
_RESET_GENERIC_MESSAGE = "E-posta kayıtlıysa sıfırlama bağlantısı gönderildi"


def _reset_rate_limited(db: Session, user: User) -> bool:
    """Bu hesap son bir saatteki sifirlama talebi sinirini asti mi? (K-44)

    Sayac icin AYRI bir tabloya gerek yok: password_reset_tokens'in kendisi
    talep gecmisidir — her talep bir satir yazar ve created_at tasir.
    (Kullanilmis/gecersiz kilinmis satirlar da sayilir; onemli olan MAIL'in
    kac kez gonderildigi, token'in akibeti degil.)

    SESSIZ sinir — 429 DEGIL: sinir asildiginda cagriya yine ayni 200 doner,
    yalnizca mail gonderilmez. Farkli bir kod/mesaj donmek K-43'un hesap
    sayimi korumasini delerdi, cunku sinir YALNIZCA gercek ve ACTIVE
    hesaplarda tetiklenebilir: "429 aldiysan bu adres kayitlidir" demek
    olurdu. Korumanin amaci mail bombardimanini durdurmak; susarak durdurmak
    bunu saglar ve hicbir sey sizdirmaz.
    """
    since = datetime.now(timezone.utc) - timedelta(hours=1)
    recent = db.query(func.count(PasswordResetToken.id)).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.created_at >= since,
    ).scalar()
    return recent >= settings.password_reset_max_per_hour


def _resolve_reset_token(db: Session, raw_token: str) -> PasswordResetToken:
    """Ham sifirlama token'ini cozer; gecersiz/kullanilmis/dolmus ise 400.

    _resolve_invitation'in (K-24) birebir ikizi: token TUKETILMEZ — used_at'i
    muhurleyen tek yer reset_password'dur. Uc hata da 400, cunku 404 verilse
    token'in varliği/yoklugu ayirt edilirdi.
    """
    reset = db.query(PasswordResetToken).filter(
        PasswordResetToken.token_hash == hash_token(raw_token)
    ).first()
    if reset is None:
        raise HTTPException(status_code=400, detail="Geçersiz sıfırlama bağlantısı")

    if reset.used_at is not None:
        raise HTTPException(status_code=400, detail="Sıfırlama bağlantısı zaten kullanılmış")

    expires = reset.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Sıfırlama bağlantısının süresi dolmuş")

    return reset


@router.post("/forgot-password", response_model=MessageResponse)
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Sifirlama linki talep eder (kontrat §1, K-43, K-44).

    HER ZAMAN 200 ve ayni mesaji doner — e-postanin kayitli olup olmadigi
    disaridan anlasilamaz (hesap sayimi/enumeration korumasi). Bu, brief
    §6.3'un "kullanici girdisini dogrula, sizdirma" cizgisinin devami.

    Mail YALNIZ ACTIVE hesaba gider:
      - PENDING hesabin zaten sifresi yok; yolu davet linkidir (resend-invitation).
      - DISABLED hesabin erisimi bilerek kapatilmis; sifirlatmak onu geri acardi.

    K-44 iki koruma katmani:
      1. CAPTCHA — e-postadan ONCE dogrulanir; basarisizsa 400. Bu 400 hicbir
         sey sizdirmaz, cunku e-posta daha hic sorgulanmadi.
      2. Saatlik talep siniri — asilirsa mail gonderilMEZ ama cevap yine
         ayni 200'dur (asagida).
    """
    # CAPTCHA once: gecersizse hicbir DB sorgusu/mail yapmadan don.
    if not verify_captcha(payload.captcha_token, request.client.host if request.client else None):
        raise HTTPException(status_code=400, detail="Doğrulama başarısız, lütfen tekrar deneyin")

    user = db.query(User).filter(User.email == payload.email).first()

    if user is not None and user.status == UserStatus.ACTIVE and not _reset_rate_limited(db, user):
        # Bekleyen eski sifirlama token'lari gecersiz kilinir: ayni anda birden
        # cok gecerli link dolasmasin (resend-invitation ile ayni desen).
        now = datetime.now(timezone.utc)
        for tok in user.password_reset_tokens:
            if tok.used_at is None:
                tok.used_at = now

        raw = generate_invitation_token()
        db.add(PasswordResetToken(
            user_id=user.id,
            token_hash=hash_token(raw),
            expires_at=now + timedelta(hours=settings.password_reset_expire_hours),
        ))

        # Iz: fail kisinin KENDISI (K-37'deki ACTIVATE ile ayni gerekce —
        # talebi yapan odur, bir admin degil).
        log_action(db, user, "RESET_REQUEST", "user", user.id, user)
        db.commit()

        # Mail commit'ten SONRA: gonderim patlarsa yarim token kaydi kalmasin
        # (invite_user ile ayni sira).
        send_password_reset_email(user.email, user.name, raw)

    return MessageResponse(message=_RESET_GENERIC_MESSAGE)


@router.get("/reset/{token}", response_model=PasswordResetPreview)
def preview_reset_token(token: str, db: Session = Depends(get_db)):
    """Sifirlama ekrani acilirken token'i on-dogrular (K-43, K-24 deseni).

    Olu linkte kullanici yeni sifresini yazmadan ONCE hatayi gorur.
    Token'i tuketmez, hicbir sey yazmaz.
    """
    reset = _resolve_reset_token(db, token)
    return PasswordResetPreview.model_validate(reset.user)


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Yeni sifreyi belirler ve token'i muhurler (K-43).

    GET on-dogrulamis olsa bile kontroller TEKRAR edilir (K-24 ile ayni
    TOCTOU gerekcesi): iki cagri arasinda sure dolabilir ya da token
    baskasinca kullanilabilir.
    """
    reset = _resolve_reset_token(db, payload.token)
    user = reset.user

    # Token gecerli olsa bile hesap bu arada kapatilmis olabilir (admin
    # DISABLED yapmis). Kapali hesaba yeni sifre yazmak, kapatma kararini
    # sessizce delerdi.
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Hesap aktif değil")

    user.password_hash = hash_password(payload.password)
    reset.used_at = datetime.now(timezone.utc)

    # Bu kullanicinin DIGER bekleyen sifirlama linkleri de yanar: sifre
    # degistikten sonra eski bir link hala calisirsa, linki ele geciren
    # kisi yeni sifreyi tekrar degistirebilirdi.
    for tok in user.password_reset_tokens:
        if tok.used_at is None:
            tok.used_at = reset.used_at

    log_action(db, user, "RESET_PASSWORD", "user", user.id, user)
    db.commit()

    return MessageResponse(message="Şifre güncellendi")


