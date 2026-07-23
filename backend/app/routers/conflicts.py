from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import conflict_service
from app.deps import get_current_user, get_db
from app.models import User
from app.schemas import ConflictScanOut

router = APIRouter(tags=["conflicts"])


@router.get("/conflicts", response_model=ConflictScanOut)
def scan_conflicts(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Workgroup'un tam çakışma taraması (kontrat §9, brief §3.6).

    **Yetki bilerek geniş:** `require_admin` DEĞİL, `get_current_user`.
    Alt hesap da tüm workgroup'un çakışmalarını görür (K-04 + K-26) — motor
    mesajı zaten karşı bölümün dersini/dersliğini/saatini yazıyor ve kullanıcı
    boş saat arayabilmek için karşı tarafın doluluğunu görmek zorunda.
    Görmeden çözmek imkânsızdı. Çözme (düzenleme) yetkisi ise değişmedi:
    bayrak + bölüm üyeliğiyle sınırlı kalır.

    Sonuç canlı hesaplanır, tabloda saklanmaz — bu yüzden çakışmanın zaman
    damgası yoktur, "en yeni çakışma" diye bir kavram da yoktur.
    """
    scan = conflict_service.scan_workgroup(db, user.workgroup_id)
    return ConflictScanOut(hard=scan["hard"], warnings=scan["warnings"])
