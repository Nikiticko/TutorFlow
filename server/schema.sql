CREATE TABLE IF NOT EXISTS teachers (
  id text PRIMARY KEY,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'premium'))
);
CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY,
  teacher_id text NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name text NOT NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  deleted_at timestamptz,
  UNIQUE (teacher_id, id)
);
CREATE TABLE IF NOT EXISTS lessons (
  id uuid PRIMARY KEY,
  teacher_id text NOT NULL,
  student_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  feedback text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  FOREIGN KEY (teacher_id, student_id) REFERENCES students(teacher_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY,
  teacher_id text NOT NULL,
  student_id uuid NOT NULL,
  amount numeric(11,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'EUR')),
  lessons_count integer NOT NULL CHECK (lessons_count BETWEEN 1 AND 1000000),
  date date NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (teacher_id, student_id) REFERENCES students(teacher_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  teacher_id text NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS students_teacher_idx ON students(teacher_id);
CREATE INDEX IF NOT EXISTS students_deleted_idx ON students(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS lessons_teacher_date_idx ON lessons(teacher_id, occurred_at);
CREATE INDEX IF NOT EXISTS payments_teacher_date_idx ON payments(teacher_id, date);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
