"""v0.3 hoca revizyonu (K-14..K-20)

- [K-18] buildings tablosu; classrooms.building (metin) -> building_id (FK)
- [K-17] classrooms.exam_capacity; exam_classrooms (coklu derslik)
- [K-14] courses ikiye ayrildi: courses (ders) + course_sections (sube)
- [K-16] exams ders duzeyine baglandi (subeden bagimsiz tek sinav)
- [K-19] delivery_mode enum + weekly_schedule_entries.delivery_mode
- [K-20] courses T+U+L saatleri + weekly_schedule_entries.session_type

Veri notu: courses / weekly_schedule_entries / exams tablolari DUSURULUP
yeniden kurulur. Bu asamada bu tablolara veri yazan hicbir endpoint/seed
yok (WP2 CRUD henuz yazilmadi; testler rollback'li calisir), yani veri
kaybi soz konusu degil. classrooms icin ise bina backfill'i yapilir.

Revision ID: f4a9c1d27b3e
Revises: c33ba85c0ae1
Create Date: 2026-07-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'f4a9c1d27b3e'
down_revision: Union[str, None] = 'c33ba85c0ae1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Mevcut enum tipleri (initial migration'da yaratildi) — create_type=False,
# yoksa create_table ayni tipi ikinci kez yaratmaya kalkar.
semester_type = postgresql.ENUM(
    'FALL', 'SPRING', 'SUMMER', name='semester_type', create_type=False
)
exam_type = postgresql.ENUM(
    'MIDTERM', 'FINAL', 'MAKEUP', name='exam_type', create_type=False
)
entry_status = postgresql.ENUM(
    'DRAFT', 'SUBMITTED', name='entry_status', create_type=False
)
# Yeni enum tipleri — upgrade() icinde op.execute ile acikca yaratilir.
session_type = postgresql.ENUM(
    'THEORY', 'PRACTICE', 'LAB', name='session_type', create_type=False
)
delivery_mode = postgresql.ENUM(
    'FACE_TO_FACE', 'ONLINE_SYNC', 'ONLINE_ASYNC',
    name='delivery_mode', create_type=False,
)


def upgrade() -> None:
    # ---- 0) Yeni enum tipleri [K-19, K-20] ----
    op.execute("CREATE TYPE session_type AS ENUM ('THEORY', 'PRACTICE', 'LAB')")
    op.execute(
        "CREATE TYPE delivery_mode AS ENUM "
        "('FACE_TO_FACE', 'ONLINE_SYNC', 'ONLINE_ASYNC')"
    )

    # ---- 1) Eski program/sinav/ders tablolari duser (veri notuna bak) ----
    op.drop_table('weekly_schedule_entries')
    op.drop_table('exams')
    op.drop_table('courses')

    # ---- 2) buildings [K-18] + classrooms'tan backfill ----
    op.create_table(
        'buildings',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('workgroup_id', sa.BigInteger(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('active', sa.Boolean(), server_default=sa.text('true'),
                  nullable=False),
        sa.ForeignKeyConstraint(['workgroup_id'], ['workgroups.id'],
                                ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('workgroup_id', 'name',
                            name='uq_buildings_workgroup_name'),
    )
    op.execute(
        """
        INSERT INTO buildings (workgroup_id, name)
        SELECT DISTINCT workgroup_id, building FROM classrooms
        """
    )

    # ---- 3) classrooms: building_id + exam_capacity [K-17, K-18] ----
    op.add_column('classrooms',
                  sa.Column('building_id', sa.BigInteger(), nullable=True))
    op.execute(
        """
        UPDATE classrooms c
        SET building_id = b.id
        FROM buildings b
        WHERE b.workgroup_id = c.workgroup_id AND b.name = c.building
        """
    )
    op.alter_column('classrooms', 'building_id', nullable=False)
    op.create_foreign_key('fk_classrooms_building', 'classrooms', 'buildings',
                          ['building_id'], ['id'], ondelete='RESTRICT')

    op.add_column('classrooms',
                  sa.Column('exam_capacity', sa.Integer(), nullable=True))
    # Mevcut satirlar icin makul varsayilan: normal kapasite. Gercek bosluklu
    # oturma degerini yetkili sonradan duzeltir (K-17).
    op.execute("UPDATE classrooms SET exam_capacity = capacity")
    op.alter_column('classrooms', 'exam_capacity', nullable=False)
    op.create_check_constraint(
        'ck_classrooms_exam_capacity_range', 'classrooms',
        'exam_capacity > 0 AND exam_capacity <= capacity',
    )

    op.drop_constraint('uq_classrooms_location', 'classrooms', type_='unique')
    op.drop_column('classrooms', 'building')
    op.create_unique_constraint('uq_classrooms_location', 'classrooms',
                                ['building_id', 'room_code'])

    # ---- 4) courses (ders, kod duzeyi) [K-14, K-20] ----
    op.create_table(
        'courses',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('department_id', sa.BigInteger(), nullable=False),
        sa.Column('year', sa.SmallInteger(), nullable=False),
        sa.Column('semester', semester_type, nullable=False),
        sa.Column('code', sa.String(length=20), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('is_elective', sa.Boolean(), server_default=sa.text('false'),
                  nullable=False),
        sa.Column('hours_theory', sa.SmallInteger(),
                  server_default=sa.text('0'), nullable=False),
        sa.Column('hours_practice', sa.SmallInteger(),
                  server_default=sa.text('0'), nullable=False),
        sa.Column('hours_lab', sa.SmallInteger(),
                  server_default=sa.text('0'), nullable=False),
        sa.Column('active', sa.Boolean(), server_default=sa.text('true'),
                  nullable=False),
        sa.CheckConstraint('year BETWEEN 1 AND 6', name='ck_courses_year_range'),
        sa.CheckConstraint('hours_theory >= 0', name='ck_courses_hours_theory'),
        sa.CheckConstraint('hours_practice >= 0',
                           name='ck_courses_hours_practice'),
        sa.CheckConstraint('hours_lab >= 0', name='ck_courses_hours_lab'),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'],
                                ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('department_id', 'year', 'semester', 'code',
                            name='uq_courses_identity'),
    )

    # ---- 5) course_sections (sube) [K-14] ----
    op.create_table(
        'course_sections',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('course_id', sa.BigInteger(), nullable=False),
        sa.Column('section_no', sa.SmallInteger(), server_default=sa.text('1'),
                  nullable=False),
        sa.Column('lecturer_id', sa.BigInteger(), nullable=False),
        sa.Column('expected_students', sa.Integer(), nullable=False),
        sa.Column('default_classroom_id', sa.BigInteger(), nullable=True),
        sa.Column('active', sa.Boolean(), server_default=sa.text('true'),
                  nullable=False),
        sa.CheckConstraint('section_no > 0', name='ck_sections_no_positive'),
        sa.CheckConstraint('expected_students > 0',
                           name='ck_sections_expected_positive'),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'],
                                ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['lecturer_id'], ['lecturers.id'],
                                ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['default_classroom_id'], ['classrooms.id'],
                                ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('course_id', 'section_no',
                            name='uq_sections_course_no'),
    )

    # ---- 6) weekly_schedule_entries (yeni: section_id + K-19/K-20 alanlari) ----
    op.create_table(
        'weekly_schedule_entries',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('section_id', sa.BigInteger(), nullable=False),
        sa.Column('classroom_id', sa.BigInteger(), nullable=True),
        sa.Column('day_of_week', sa.SmallInteger(), nullable=False),
        sa.Column('start_slot', sa.SmallInteger(), nullable=False),
        sa.Column('slot_count', sa.SmallInteger(), server_default=sa.text('1'),
                  nullable=False),
        sa.Column('session_type', session_type,
                  server_default=sa.text("'THEORY'"), nullable=False),
        sa.Column('delivery_mode', delivery_mode,
                  server_default=sa.text("'FACE_TO_FACE'"), nullable=False),
        sa.Column('status', entry_status, server_default=sa.text("'DRAFT'"),
                  nullable=False),
        sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint('day_of_week BETWEEN 1 AND 5'),
        sa.CheckConstraint('start_slot BETWEEN 1 AND 9'),
        sa.CheckConstraint('slot_count >= 1'),
        sa.CheckConstraint('start_slot + slot_count - 1 <= 9',
                           name='ck_wse_slot_overflow'),
        sa.CheckConstraint(
            "(status = 'SUBMITTED') = (submitted_at IS NOT NULL)",
            name='ck_wse_status_submitted_consistency'),
        sa.ForeignKeyConstraint(['section_id'], ['course_sections.id'],
                                ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['classroom_id'], ['classrooms.id'],
                                ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'],
                                ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_wse_classroom_day', 'weekly_schedule_entries',
                    ['classroom_id', 'day_of_week'])
    op.create_index('idx_wse_section', 'weekly_schedule_entries', ['section_id'])
    op.create_index('idx_wse_status', 'weekly_schedule_entries', ['status'])

    # ---- 7) exams (yeni: ders duzeyi, tek classroom_id kalkti) [K-16] ----
    op.create_table(
        'exams',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('course_id', sa.BigInteger(), nullable=False),
        sa.Column('exam_type', exam_type, nullable=False),
        sa.Column('exam_date', sa.Date(), nullable=False),
        sa.Column('start_time', sa.Time(), nullable=False),
        sa.Column('duration_minutes', sa.Integer(), nullable=False),
        sa.Column('lecturer_id', sa.BigInteger(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('status', entry_status, server_default=sa.text("'DRAFT'"),
                  nullable=False),
        sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint('duration_minutes BETWEEN 10 AND 480'),
        sa.CheckConstraint('EXTRACT(ISODOW FROM exam_date) BETWEEN 1 AND 5',
                           name='ck_exams_weekday_only'),
        sa.CheckConstraint(
            "(status = 'SUBMITTED') = (submitted_at IS NOT NULL)",
            name='ck_exams_status_submitted_consistency'),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'],
                                ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['lecturer_id'], ['lecturers.id'],
                                ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'],
                                ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('course_id', 'exam_type',
                            name='uq_exams_course_type'),
    )
    op.create_index('idx_exams_date', 'exams', ['exam_date'])
    op.create_index('idx_exams_status', 'exams', ['status'])

    # ---- 8) exam_classrooms (coklu derslik) [K-17] ----
    op.create_table(
        'exam_classrooms',
        sa.Column('exam_id', sa.BigInteger(), nullable=False),
        sa.Column('classroom_id', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['exam_id'], ['exams.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['classroom_id'], ['classrooms.id'],
                                ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('exam_id', 'classroom_id'),
    )
    op.create_index('idx_exam_classrooms_classroom', 'exam_classrooms',
                    ['classroom_id'])


def downgrade() -> None:
    # Yeni tablolar duser (bagimlilik sirasiyla).
    op.drop_table('exam_classrooms')
    op.drop_table('exams')
    op.drop_table('weekly_schedule_entries')
    op.drop_table('course_sections')
    op.drop_table('courses')

    # classrooms: building metnini geri getir, yeni alanlari dusur.
    op.add_column('classrooms',
                  sa.Column('building', sa.String(length=100), nullable=True))
    op.execute(
        """
        UPDATE classrooms c
        SET building = b.name
        FROM buildings b
        WHERE b.id = c.building_id
        """
    )
    op.alter_column('classrooms', 'building', nullable=False)
    op.drop_constraint('uq_classrooms_location', 'classrooms', type_='unique')
    op.drop_constraint('ck_classrooms_exam_capacity_range', 'classrooms',
                       type_='check')
    op.drop_constraint('fk_classrooms_building', 'classrooms',
                       type_='foreignkey')
    op.drop_column('classrooms', 'exam_capacity')
    op.drop_column('classrooms', 'building_id')
    op.create_unique_constraint('uq_classrooms_location', 'classrooms',
                                ['workgroup_id', 'building', 'room_code'])
    op.drop_table('buildings')

    # v0.2 courses / weekly_schedule_entries / exams geri kurulur.
    op.create_table(
        'courses',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('department_id', sa.BigInteger(), nullable=False),
        sa.Column('year', sa.SmallInteger(), nullable=False),
        sa.Column('semester', semester_type, nullable=False),
        sa.Column('code', sa.String(length=20), nullable=False),
        sa.Column('section_no', sa.SmallInteger(), server_default=sa.text('1'),
                  nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('lecturer_id', sa.BigInteger(), nullable=False),
        sa.Column('expected_students', sa.Integer(), nullable=False),
        sa.Column('is_elective', sa.Boolean(), server_default=sa.text('false'),
                  nullable=False),
        sa.Column('default_classroom_id', sa.BigInteger(), nullable=True),
        sa.Column('active', sa.Boolean(), server_default=sa.text('true'),
                  nullable=False),
        sa.CheckConstraint('expected_students > 0',
                           name='ck_courses_expected_positive'),
        sa.CheckConstraint('section_no > 0', name='ck_courses_section_positive'),
        sa.CheckConstraint('year BETWEEN 1 AND 6', name='ck_courses_year_range'),
        sa.ForeignKeyConstraint(['default_classroom_id'], ['classrooms.id'],
                                ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'],
                                ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['lecturer_id'], ['lecturers.id'],
                                ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('department_id', 'year', 'semester', 'code',
                            'section_no', name='uq_courses_identity'),
    )
    op.create_table(
        'weekly_schedule_entries',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('course_id', sa.BigInteger(), nullable=False),
        sa.Column('classroom_id', sa.BigInteger(), nullable=True),
        sa.Column('day_of_week', sa.SmallInteger(), nullable=False),
        sa.Column('start_slot', sa.SmallInteger(), nullable=False),
        sa.Column('slot_count', sa.SmallInteger(), server_default=sa.text('1'),
                  nullable=False),
        sa.Column('status', entry_status, server_default=sa.text("'DRAFT'"),
                  nullable=False),
        sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("(status = 'SUBMITTED') = (submitted_at IS NOT NULL)",
                           name='ck_wse_status_submitted_consistency'),
        sa.CheckConstraint('start_slot + slot_count - 1 <= 9',
                           name='ck_wse_slot_overflow'),
        sa.ForeignKeyConstraint(['classroom_id'], ['classrooms.id'],
                                ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'],
                                ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'],
                                ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_wse_classroom_day', 'weekly_schedule_entries',
                    ['classroom_id', 'day_of_week'])
    op.create_index('idx_wse_course', 'weekly_schedule_entries', ['course_id'])
    op.create_index('idx_wse_status', 'weekly_schedule_entries', ['status'])
    op.create_table(
        'exams',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('course_id', sa.BigInteger(), nullable=False),
        sa.Column('exam_type', exam_type, nullable=False),
        sa.Column('exam_date', sa.Date(), nullable=False),
        sa.Column('start_time', sa.Time(), nullable=False),
        sa.Column('duration_minutes', sa.Integer(), nullable=False),
        sa.Column('classroom_id', sa.BigInteger(), nullable=True),
        sa.Column('lecturer_id', sa.BigInteger(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('status', entry_status, server_default=sa.text("'DRAFT'"),
                  nullable=False),
        sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint(
            "(status = 'SUBMITTED') = (submitted_at IS NOT NULL)",
            name='ck_exams_status_submitted_consistency'),
        sa.CheckConstraint('EXTRACT(ISODOW FROM exam_date) BETWEEN 1 AND 5',
                           name='ck_exams_weekday_only'),
        sa.ForeignKeyConstraint(['classroom_id'], ['classrooms.id'],
                                ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'],
                                ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'],
                                ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['lecturer_id'], ['lecturers.id'],
                                ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('course_id', 'exam_type',
                            name='uq_exams_course_type'),
    )
    op.create_index('idx_exams_classroom_date', 'exams',
                    ['classroom_id', 'exam_date'])
    op.create_index('idx_exams_date', 'exams', ['exam_date'])
    op.create_index('idx_exams_status', 'exams', ['status'])

    # Yeni enum tipleri duser.
    op.execute('DROP TYPE IF EXISTS delivery_mode')
    op.execute('DROP TYPE IF EXISTS session_type')
