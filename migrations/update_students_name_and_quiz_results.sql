-- ==============================================================================
-- Migration: Split Student full_name into last_name, first_name, middle_name (optional)
--            & Add student_quiz_results table for per-quiz score tracking/Excel export
-- ==============================================================================

-- 1. Add last_name, first_name, and optional middle_name columns to public.students
ALTER TABLE public.students
    ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS middle_name TEXT DEFAULT NULL;

-- Make full_name nullable so inserting (last_name, first_name, middle_name) directly never fails
ALTER TABLE public.students
    ALTER COLUMN full_name DROP NOT NULL;

COMMENT ON COLUMN public.students.last_name IS 'Student family / last name (required)';
COMMENT ON COLUMN public.students.first_name IS 'Student given / first name (required)';
COMMENT ON COLUMN public.students.middle_name IS 'Student middle name or middle initial (optional)';

-- 2. Backfill last_name, first_name, middle_name from existing full_name records
DO $$
DECLARE
    rec RECORD;
    v_raw TEXT;
    v_last TEXT;
    v_first TEXT;
    v_middle TEXT;
    v_after_comma TEXT;
    v_tokens TEXT[];
    v_len INT;
BEGIN
    FOR rec IN
        SELECT id, full_name, last_name, first_name, middle_name
        FROM public.students
        WHERE (last_name IS NULL OR BTRIM(last_name) = '')
          AND full_name IS NOT NULL
          AND BTRIM(full_name) <> ''
    LOOP
        v_raw := BTRIM(REGEXP_REPLACE(rec.full_name, '\s+', ' ', 'g'));
        v_last := '';
        v_first := '';
        v_middle := NULL;

        IF POSITION(',' IN v_raw) > 0 THEN
            -- Format: "Lastname, Firstname [Middlename]"
            v_last := BTRIM(SPLIT_PART(v_raw, ',', 1));
            v_after_comma := BTRIM(SUBSTRING(v_raw FROM POSITION(',' IN v_raw) + 1));
            v_tokens := STRING_TO_ARRAY(v_after_comma, ' ');
            v_len := COALESCE(ARRAY_LENGTH(v_tokens, 1), 0);

            IF v_len = 1 THEN
                v_first := v_tokens[1];
                v_middle := NULL;
            ELSIF v_len >= 2 THEN
                v_middle := v_tokens[v_len];
                v_first := ARRAY_TO_STRING(v_tokens[1:v_len - 1], ' ');
            END IF;
        ELSE
            -- Format: "Firstname [Middlename] Lastname"
            v_tokens := STRING_TO_ARRAY(v_raw, ' ');
            v_len := COALESCE(ARRAY_LENGTH(v_tokens, 1), 0);

            IF v_len = 1 THEN
                v_last := v_tokens[1];
                v_first := '';
                v_middle := NULL;
            ELSIF v_len = 2 THEN
                v_first := v_tokens[1];
                v_last := v_tokens[2];
                v_middle := NULL;
            ELSIF v_len >= 3 THEN
                v_first := v_tokens[1];
                v_last := v_tokens[v_len];
                v_middle := ARRAY_TO_STRING(v_tokens[2:v_len - 1], ' ');
            END IF;
        END IF;

        UPDATE public.students
        SET last_name = COALESCE(v_last, ''),
            first_name = COALESCE(v_first, ''),
            middle_name = NULLIF(BTRIM(COALESCE(v_middle, '')), '')
        WHERE id = rec.id;
    END LOOP;
END $$;

-- 3. Trigger to keep last_name, first_name, middle_name and full_name synchronized
CREATE OR REPLACE FUNCTION public.sync_student_name_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_raw TEXT;
    v_after_comma TEXT;
    v_tokens TEXT[];
    v_len INT;
BEGIN
    NEW.last_name := COALESCE(BTRIM(NEW.last_name), '');
    NEW.first_name := COALESCE(BTRIM(NEW.first_name), '');
    NEW.middle_name := NULLIF(BTRIM(COALESCE(NEW.middle_name, '')), '');

    -- If last_name and first_name are empty but full_name was provided, parse full_name
    IF NEW.last_name = '' AND NEW.first_name = '' AND NEW.full_name IS NOT NULL AND BTRIM(NEW.full_name) <> '' THEN
        v_raw := BTRIM(REGEXP_REPLACE(NEW.full_name, '\s+', ' ', 'g'));
        IF POSITION(',' IN v_raw) > 0 THEN
            NEW.last_name := BTRIM(SPLIT_PART(v_raw, ',', 1));
            v_after_comma := BTRIM(SUBSTRING(v_raw FROM POSITION(',' IN v_raw) + 1));
            v_tokens := STRING_TO_ARRAY(v_after_comma, ' ');
            v_len := COALESCE(ARRAY_LENGTH(v_tokens, 1), 0);
            IF v_len = 1 THEN
                NEW.first_name := v_tokens[1];
            ELSIF v_len >= 2 THEN
                NEW.middle_name := NULLIF(BTRIM(v_tokens[v_len]), '');
                NEW.first_name := ARRAY_TO_STRING(v_tokens[1:v_len - 1], ' ');
            END IF;
        ELSE
            v_tokens := STRING_TO_ARRAY(v_raw, ' ');
            v_len := COALESCE(ARRAY_LENGTH(v_tokens, 1), 0);
            IF v_len = 1 THEN
                NEW.last_name := v_tokens[1];
            ELSIF v_len = 2 THEN
                NEW.first_name := v_tokens[1];
                NEW.last_name := v_tokens[2];
            ELSIF v_len >= 3 THEN
                NEW.first_name := v_tokens[1];
                NEW.last_name := v_tokens[v_len];
                NEW.middle_name := NULLIF(BTRIM(ARRAY_TO_STRING(v_tokens[2:v_len - 1], ' ')), '');
            END IF;
        END IF;
    END IF;

    -- Always compute formatted full_name ("Last Name, First Name Middle Name")
    IF NEW.last_name <> '' AND NEW.first_name <> '' THEN
        NEW.full_name := NEW.last_name || ', ' || NEW.first_name ||
            CASE WHEN NEW.middle_name IS NOT NULL THEN ' ' || NEW.middle_name ELSE '' END;
    ELSIF NEW.last_name <> '' THEN
        NEW.full_name := NEW.last_name ||
            CASE WHEN NEW.middle_name IS NOT NULL THEN ' ' || NEW.middle_name ELSE '' END;
    ELSIF NEW.first_name <> '' THEN
        NEW.full_name := NEW.first_name ||
            CASE WHEN NEW.middle_name IS NOT NULL THEN ' ' || NEW.middle_name ELSE '' END;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_student_names ON public.students;
CREATE TRIGGER trg_sync_student_names
    BEFORE INSERT OR UPDATE ON public.students
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_student_name_columns();

-- 4. Create public.student_quiz_results table for storing individual Quiz 1, Quiz 2, Quiz 3... scores
CREATE TABLE IF NOT EXISTS public.student_quiz_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
    quiz_id TEXT,
    quiz_title TEXT NOT NULL,
    total_score NUMERIC NOT NULL DEFAULT 0,
    max_score NUMERIC NOT NULL DEFAULT 0,
    score_percentage NUMERIC NOT NULL DEFAULT 0,
    item_results JSONB DEFAULT '[]'::jsonb,
    graded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (student_id, classroom_id, quiz_title)
);

CREATE INDEX IF NOT EXISTS idx_student_quiz_results_classroom
    ON public.student_quiz_results(classroom_id);

CREATE INDEX IF NOT EXISTS idx_student_quiz_results_student
    ON public.student_quiz_results(student_id);

ALTER TABLE public.student_quiz_results ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'student_quiz_results'
          AND policyname = 'Teachers can manage quiz results for their classrooms'
    ) THEN
        CREATE POLICY "Teachers can manage quiz results for their classrooms"
            ON public.student_quiz_results
            FOR ALL
            USING (
                EXISTS (
                    SELECT 1 FROM public.classrooms c
                    WHERE c.id = student_quiz_results.classroom_id
                      AND c.teacher_id = auth.uid()
                )
            )
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM public.classrooms c
                    WHERE c.id = student_quiz_results.classroom_id
                      AND c.teacher_id = auth.uid()
                )
            );
    END IF;
END $$;
