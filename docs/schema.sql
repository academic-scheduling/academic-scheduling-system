-- ============================================================
-- Akademik Ders Programı ve Sınav Çakışma Yönetim Sistemi
-- PostgreSQL 16 Şeması — v0.2 (karar defteri K-01..K-11 uyumlu)
-- Değişiklikler v0.1 -> v0.2:
--   [K-08] lecturers tablosu; courses/exams'ta FK (serbest metin kalktı)
--   [K-03] entry_status enum + status/submitted_at alanları (DRAFT/SUBMITTED)
--   [K-10] classroom_id nullable (online dersler için önlem)
--   [K-07] expected_students zorunlu (NOT NULL)
--   [K-06] exams: hafta içi CHECK; saat penceresi kısıtı YOK
-- ============================================================

CREATE TYPE user_role AS ENUM ('ADMIN', 'SUB_ACCOUNT');
CREATE TYPE user_status AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');
CREATE TYPE semester_type AS ENUM ('FALL', 'SPRING', 'SUMMER');
CREATE TYPE exam_type AS ENUM ('MIDTERM', 'FINAL', 'MAKEUP');
CREATE TYPE entry_status AS ENUM ('DRAFT', 'SUBMITTED');          -- [K-03]

CREATE TABLE workgroups (
    id                   BIGSERIAL PRIMARY KEY,
    name                 VARCHAR(200) NOT NULL,
    type                 VARCHAR(50)  NOT NULL DEFAULT 'FACULTY',
    allowed_email_domain VARCHAR(100) NOT NULL,
    check_exam_vs_course BOOLEAN      NOT NULL DEFAULT TRUE,      -- [K-06] vize için AÇIK
    created_by           BIGINT,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    workgroup_id  BIGINT REFERENCES workgroups(id) ON DELETE CASCADE,
    name          VARCHAR(200) NOT NULL,
    email         VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(255),
    role          user_role    NOT NULL,
    status        user_status  NOT NULL DEFAULT 'PENDING',
    can_manage_classrooms BOOLEAN NOT NULL DEFAULT FALSE,         -- [K-02]
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE workgroups
    ADD CONSTRAINT fk_workgroups_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE invitation_tokens (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE departments (
    id           BIGSERIAL PRIMARY KEY,
    workgroup_id BIGINT       NOT NULL REFERENCES workgroups(id) ON DELETE CASCADE,
    name         VARCHAR(200) NOT NULL,
    code         VARCHAR(20)  NOT NULL,
    UNIQUE (workgroup_id, code)
);

CREATE TABLE department_memberships (
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    department_id BIGINT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, department_id)
);

-- [K-08] YENİ: yönetilen hoca listesi (serbest metin yerine)
CREATE TABLE lecturers (
    id              BIGSERIAL PRIMARY KEY,
    workgroup_id    BIGINT       NOT NULL REFERENCES workgroups(id) ON DELETE CASCADE,
    full_name       VARCHAR(200) NOT NULL,        -- görünen ad (unvanlı): "Doç. Dr. Ayşe Kaya"
    normalized_name VARCHAR(200) NOT NULL,        -- eşleştirme anahtarı: küçük harf, unvansız, tek boşluk
    email           VARCHAR(254),
    is_external     BOOLEAN      NOT NULL DEFAULT FALSE,  -- 40/a dış görevlendirme
    source          VARCHAR(20)  NOT NULL DEFAULT 'IMPORT', -- IMPORT / MANUAL
    active          BOOLEAN      NOT NULL DEFAULT TRUE,
    UNIQUE (workgroup_id, normalized_name)
    -- Not: aynı ada sahip iki gerçek hoca çıkarsa normalized_name'e
    -- ayırt edici ek verilir (örn. "ayse kaya (fizik)"). Import script'i
    -- bu çakışmayı raporlamalı, sessizce birleştirmemeli.
);

CREATE TABLE classrooms (
    id           BIGSERIAL PRIMARY KEY,
    workgroup_id BIGINT       NOT NULL REFERENCES workgroups(id) ON DELETE CASCADE,
    building     VARCHAR(100) NOT NULL,
    room_code    VARCHAR(30)  NOT NULL,
    capacity     INT          NOT NULL CHECK (capacity > 0),      -- [K-07] zorunlu
    active       BOOLEAN      NOT NULL DEFAULT TRUE,
    UNIQUE (workgroup_id, building, room_code)
);

CREATE TABLE courses (
    id                BIGSERIAL PRIMARY KEY,
    department_id     BIGINT        NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    year              SMALLINT      NOT NULL CHECK (year BETWEEN 1 AND 6),
    semester          semester_type NOT NULL,
    code              VARCHAR(20)   NOT NULL,
    section_no        SMALLINT      NOT NULL DEFAULT 1 CHECK (section_no > 0),
    name              VARCHAR(200)  NOT NULL,
    lecturer_id       BIGINT        NOT NULL REFERENCES lecturers(id) ON DELETE RESTRICT, -- [K-08]
    expected_students INT           NOT NULL CHECK (expected_students > 0),               -- [K-07]
    is_elective       BOOLEAN       NOT NULL DEFAULT FALSE,       -- [K-05] MVP kuralında aktif
    default_classroom_id BIGINT REFERENCES classrooms(id) ON DELETE SET NULL,
    active            BOOLEAN       NOT NULL DEFAULT TRUE,
    UNIQUE (department_id, year, semester, code, section_no)
);

CREATE TABLE slots (
    slot_no    SMALLINT PRIMARY KEY CHECK (slot_no BETWEEN 1 AND 9),
    start_time TIME NOT NULL,
    end_time   TIME NOT NULL
);

INSERT INTO slots (slot_no, start_time, end_time) VALUES
    (1, '08:30', '09:15'), (2, '09:30', '10:15'), (3, '10:30', '11:15'),
    (4, '11:30', '12:15'), (5, '12:30', '13:15'), (6, '13:30', '14:15'),
    (7, '14:30', '15:15'), (8, '15:30', '16:15'), (9, '16:30', '17:15');

CREATE TABLE weekly_schedule_entries (
    id           BIGSERIAL PRIMARY KEY,
    course_id    BIGINT   NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    classroom_id BIGINT   REFERENCES classrooms(id) ON DELETE RESTRICT,   -- [K-10] nullable
    day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 5),
    start_slot   SMALLINT NOT NULL CHECK (start_slot BETWEEN 1 AND 9),
    slot_count   SMALLINT NOT NULL DEFAULT 1 CHECK (slot_count >= 1),
    status       entry_status NOT NULL DEFAULT 'DRAFT',                   -- [K-03]
    submitted_at TIMESTAMPTZ,                                             -- [K-03]
    created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (start_slot + slot_count - 1 <= 9),
    CHECK ((status = 'SUBMITTED') = (submitted_at IS NOT NULL))
);

CREATE INDEX idx_wse_classroom_day ON weekly_schedule_entries (classroom_id, day_of_week);
CREATE INDEX idx_wse_course ON weekly_schedule_entries (course_id);
CREATE INDEX idx_wse_status ON weekly_schedule_entries (status);

CREATE TABLE exams (
    id               BIGSERIAL PRIMARY KEY,
    course_id        BIGINT    NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    exam_type        exam_type NOT NULL,
    exam_date        DATE      NOT NULL,
    start_time       TIME      NOT NULL,          -- [K-06] saat penceresi kısıtı YOK
    duration_minutes INT       NOT NULL CHECK (duration_minutes BETWEEN 10 AND 480),
    classroom_id     BIGINT    REFERENCES classrooms(id) ON DELETE RESTRICT,  -- [K-10] nullable
    lecturer_id      BIGINT    NOT NULL REFERENCES lecturers(id) ON DELETE RESTRICT, -- [K-08]
    notes            TEXT,
    status           entry_status NOT NULL DEFAULT 'DRAFT',                   -- [K-03]
    submitted_at     TIMESTAMPTZ,
    created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (course_id, exam_type),
    CHECK (EXTRACT(ISODOW FROM exam_date) BETWEEN 1 AND 5),                   -- [K-06] hafta sonu yok
    CHECK ((status = 'SUBMITTED') = (submitted_at IS NOT NULL))
);

CREATE INDEX idx_exams_date ON exams (exam_date);
CREATE INDEX idx_exams_classroom_date ON exams (classroom_id, exam_date);
CREATE INDEX idx_exams_status ON exams (status);

CREATE TABLE audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action      VARCHAR(10)  NOT NULL,   -- CREATE / UPDATE / DELETE / SUBMIT
    entity_type VARCHAR(50)  NOT NULL,
    entity_id   BIGINT       NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ============================================================
-- Tasarım Notları (v0.2):
-- 1) SUBMIT akışı: submit isteği bir giriş kümesi alır; çakışma motoru
--    kümeyi DRAFT+SUBMITTED tüm girişlere karşı doğrular; temizse tek
--    transaction içinde status='SUBMITTED', submitted_at=now() yapılır
--    ve audit_logs'a SUBMIT kaydı düşülür.
-- 2) Kilitleme uygulama katmanında: SUBMITTED girişte UPDATE/DELETE
--    yalnızca "DRAFT'a geri çevir" işlemiyle mümkün olur.
-- 3) classroom_id NULL ise derslik ve kapasite kuralları atlanır (K-10).
-- 4) ExamRoom ve ConflictLog hâlâ bilinçli olarak yok (Could backlog).
-- ============================================================
