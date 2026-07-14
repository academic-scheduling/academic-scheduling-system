"""WP2 audit log testleri — CRUD yazma işlemleri iz bırakıyor mu (audit_logs)."""

from app.db import SessionLocal
from app.models import AuditLog
from tests.helpers import client, admin_headers, _u


def _audit_exists(action: str, entity_type: str, entity_id: int) -> bool:
    db = SessionLocal()
    row = db.query(AuditLog).filter(
        AuditLog.action == action,
        AuditLog.entity_type == entity_type,
        AuditLog.entity_id == entity_id,
    ).first()
    db.close()
    return row is not None


def test_audit_on_department_create():
    h = admin_headers()
    dep = client.post("/departments", json={"name": "İz Bölümü", "code": _u("IZ")}, headers=h).json()
    assert _audit_exists("CREATE", "department", dep["id"])


def test_audit_on_department_update():
    h = admin_headers()
    dep = client.post("/departments", json={"name": "Eski", "code": _u("IZ")}, headers=h).json()
    client.patch(f"/departments/{dep['id']}", json={"name": "Yeni"}, headers=h)
    assert _audit_exists("UPDATE", "department", dep["id"])


def test_audit_on_building_create():
    h = admin_headers()
    bld = client.post("/buildings", json={"name": _u("İzBina-")}, headers=h).json()
    assert _audit_exists("CREATE", "building", bld["id"])


def test_audit_on_section_delete():
    h = admin_headers()
    dep = client.post("/departments", json={"name": "S", "code": _u("SD")}, headers=h).json()
    lec = client.post("/lecturers", json={"full_name": f"Dr. İz {_u('')}"}, headers=h).json()
    course = client.post("/courses", json={
        "department_id": dep["id"], "year": 1, "semester": "FALL",
        "code": _u("IZ"), "name": "İz Dersi",
    }, headers=h).json()
    sec = client.post(f"/courses/{course['id']}/sections", json={
        "section_no": 1, "lecturer_id": lec["id"], "expected_students": 30,
    }, headers=h).json()

    assert client.delete(f"/course-sections/{sec['id']}", headers=h).status_code == 204
    assert _audit_exists("DELETE", "course_section", sec["id"])
