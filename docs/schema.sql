-- ============================================================
-- Akademik Ders Programı ve Sınav Çakışma Yönetim Sistemi
-- PostgreSQL 16 Şeması — v0.3 (karar defteri K-01..K-21 uyumlu)
-- Değişiklikler v0.2 -> v0.3 (13-14 Temmuz 2026 hoca toplantısı):
--   [K-14] courses ikiye ayrıldı: courses (ders) + course_sections (şube)
--   [K-16] exams ders düzeyine bağlandı (şubeden bağımsız tek sınav)
--   [K-17] classrooms.exam_capacity + exam_classrooms (çoklu derslik)
--   [K-18] buildings tablosu; classrooms.building (metin) -> building_id (FK)
--   [K-19] delivery_mode enum + weekly_schedule_entries.delivery_mode
--   [K-20] courses T+U+L saatleri + weekly_schedule_entries.session_type
--   [K-21] classrooms.exam_capacity opsiyonel (NULL = sınav dersliği değil/henüz girilmedi)
-- ============================================================

CREATE TYPE user_role AS ENUM ('ADMIN', 'SUB_ACCOUNT');
CREATE TYPE user_status AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');
CREATE TYPE semester_type AS ENUM ('FALL', 'SPRING', 'SUMMER');
CREATE TYPE exam_type AS ENUM ('MIDTERM', 'FINAL', 'MAKEUP');
CREATE TYPE entry_status AS ENUM ('DRAFT', 'SUBMITTED');          -- [K-03]
CREATE TYPE session_type AS ENUM ('THEORY', 'PRACTICE', 'LAB');   -- [K-20]
CREATE TYPE delivery_mode AS ENUM ('FACE_TO_FACE', 'ONLINE_SYNC', 'ONLINE_ASYNC'); -- [K-19]

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

-- [K-08] yönetilen hoca listesi (serbest metin yerine)
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

-- [K-18] YENİ: bina yönetilen entity ("Müh. Fak." / "Mühendislik" tutarsızlığına karşı)
CREATE TABLE buildings (
    id           BIGSERIAL PRIMARY KEY,
    workgroup_id BIGINT       NOT NULL REFERENCES workgroups(id) ON DELETE CASCADE,
    name         VARCHAR(100) NOT NULL,
    active       BOOLEAN      NOT NULL DEFAULT TRUE,
    UNIQUE (workgroup_id, name)
);

CREATE TABLE classrooms (
    id            BIGSERIAL PRIMARY KEY,
    workgroup_id  BIGINT NOT NULL REFERENCES workgroups(id) ON DELETE CASCADE,
    building_id   BIGINT NOT NULL REFERENCES buildings(id) ON DELETE RESTRICT, -- [K-18]
    room_code     VARCHAR(30) NOT NULL,
    capacity      INT NOT NULL CHECK (capacity > 0),               -- [K-07] zorunlu
    exam_capacity INT,                                    -- [K-17/K-21] boşluklu oturma; opsiyonel, sınavda kullanılacaksa girilir
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (building_id, room_code),
    CHECK (exam_capacity > 0 AND exam_capacity <= capacity)        -- [K-17]
);

-- [K-14] Ders: kod düzeyi. Ad, seçmelilik ve T+U+L şubeler arasında ORTAKTIR.
CREATE TABLE courses (
    id             BIGSERIAL PRIMARY KEY,
    department_id  BIGINT        NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    year           SMALLINT      NOT NULL CHECK (year BETWEEN 1 AND 6),
    semester       semester_type NOT NULL,
    code           VARCHAR(20)   NOT NULL,
    name           VARCHAR(200)  NOT NULL,
    is_elective    BOOLEAN       NOT NULL DEFAULT FALSE,           -- [K-05]
    hours_theory   SMALLINT      NOT NULL DEFAULT 0 CHECK (hours_theory >= 0),   -- [K-20] T
    hours_practice SMALLINT      NOT NULL DEFAULT 0 CHECK (hours_practice >= 0), -- [K-20] U
    hours_lab      SMALLINT      NOT NULL DEFAULT 0 CHECK (hours_lab >= 0),      -- [K-20] L
    active         BOOLEAN       NOT NULL DEFAULT TRUE,
    UNIQUE (department_id, year, semester, code)
);

-- [K-14] Şube: hoca, öğrenci sayısı ve varsayılan derslik şube düzeyindedir.
CREATE TABLE course_sections (
    id                BIGSERIAL PRIMARY KEY,
    course_id         BIGINT   NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    section_no        SMALLINT NOT NULL DEFAULT 1 CHECK (section_no > 0),
    lecturer_id       BIGINT   NOT NULL REFERENCES lecturers(id) ON DELETE RESTRICT, -- [K-08]
    expected_students INT      NOT NULL CHECK (expected_students > 0),               -- [K-07]
    default_classroom_id BIGINT REFERENCES classrooms(id) ON DELETE SET NULL,
    active            BOOLEAN  NOT NULL DEFAULT TRUE,
    UNIQUE (course_id, section_no)
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
    id            BIGSERIAL PRIMARY KEY,
    section_id    BIGINT   NOT NULL REFERENCES course_sections(id) ON DELETE CASCADE, -- [K-14]
    classroom_id  BIGINT   REFERENCES classrooms(id) ON DELETE RESTRICT,   -- [K-10/K-19] nullable
    day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 5),
    start_slot    SMALLINT NOT NULL CHECK (start_slot BETWEEN 1 AND 9),
    slot_count    SMALLINT NOT NULL DEFAULT 1 CHECK (slot_count >= 1),
    session_type  session_type  NOT NULL DEFAULT 'THEORY',                 -- [K-20]
    delivery_mode delivery_mode NOT NULL DEFAULT 'FACE_TO_FACE',           -- [K-19]
    status        entry_status  NOT NULL DEFAULT 'DRAFT',                  -- [K-03]
    submitted_at  TIMESTAMPTZ,                                             -- [K-03]
    created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (start_slot + slot_count - 1 <= 9),
    CHECK ((status = 'SUBMITTED') = (submitted_at IS NOT NULL))
);

CREATE INDEX idx_wse_classroom_day ON weekly_schedule_entries (classroom_id, day_of_week);
CREATE INDEX idx_wse_section ON weekly_schedule_entries (section_id);
CREATE INDEX idx_wse_status ON weekly_schedule_entries (status);

-- [K-16] Sınav DERS düzeyine bağlıdır (şubeden bağımsız; tüm şubeler aynı sınava girer).
CREATE TABLE exams (
    id               BIGSERIAL PRIMARY KEY,
    course_id        BIGINT    NOT NULL REFERENCES courses(id) ON DELETE CASCADE, -- [K-16] ders!
    exam_type        exam_type NOT NULL,
    exam_date        DATE      NOT NULL,
    start_time       TIME      NOT NULL,          -- [K-06] saat penceresi kısıtı YOK
    duration_minutes INT       NOT NULL CHECK (duration_minutes BETWEEN 10 AND 480),
    lecturer_id      BIGINT    NOT NULL REFERENCES lecturers(id) ON DELETE RESTRICT, -- sorumlu
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
CREATE INDEX idx_exams_status ON exams (status);

-- [K-17] YENİ: bir sınav birden çok derslikte yapılabilir.
-- Dersliksiz sınav = sıfır satır (v0.2'deki nullable classroom_id'nin yerini alır).
CREATE TABLE exam_classrooms (
    exam_id      BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    classroom_id BIGINT NOT NULL REFERENCES classrooms(id) ON DELETE RESTRICT,
    PRIMARY KEY (exam_id, classroom_id)
);

CREATE INDEX idx_exam_classrooms_classroom ON exam_classrooms (classroom_id);

CREATE TABLE audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action      VARCHAR(10)  NOT NULL,   -- CREATE / UPDATE / DELETE / SUBMIT
    entity_type VARCHAR(50)  NOT NULL,
    entity_id   BIGINT       NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ============================================================
-- Tasarım Notları (v0.3):
-- 1) SUBMIT akışı: submit isteği bir giriş kümesi alır; çakışma motoru
--    kümeyi DRAFT+SUBMITTED tüm girişlere karşı doğrular; temizse tek
--    transaction içinde status='SUBMITTED', submitted_at=now() yapılır
--    ve audit_logs'a SUBMIT kaydı düşülür.
-- 2) Kilitleme uygulama katmanında: SUBMITTED girişte UPDATE/DELETE
--    yalnızca "DRAFT'a geri çevir" işlemiyle mümkün olur.
-- 3) classroom_id NULL ise derslik ve kapasite kuralları atlanır (K-10);
--    delivery_mode='ONLINE_ASYNC' giriş TÜM çakışma kurallarından muaftır (K-19).
-- 4) Sınavın öğrenci sayısı türetilir: SUM(course_sections.expected_students)
--    WHERE course_id = exam.course_id AND active (K-16/K-17).
-- 5) W8 tamlık kontrolü sorgusu: section'ın girişleri session_type bazında
--    GROUP BY edilip SUM(slot_count), courses.hours_* ile karşılaştırılır (K-20).
-- 6) ConflictLog hâlâ bilinçli olarak yok (Could backlog).
-- ============================================================
