/*
# CMDZ — Enhanced patient form schema

1. patients table: add emergency_contact_relationship, marital_status
2. medical_files: add marital_status, observations, risk_factors (text[]), usual_medications (text)
3. allergies: add allergen, category, reaction columns
4. New table: medical_histories (medical antecedents)
5. New table: surgical_histories (surgical antecedents)
6. New table: family_histories (family antecedents)
7. New table: pregnancies (obstetric info, only for female patients)
8. RLS policies on all new tables (admin/doctor/reception for SELECT/INSERT/UPDATE, admin/doctor for DELETE)
9. Indexes on patient_id
*/

-- === patients additions ===
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship text,
  ADD COLUMN IF NOT EXISTS marital_status text;

-- === medical_files additions ===
ALTER TABLE public.medical_files
  ADD COLUMN IF NOT EXISTS marital_status text,
  ADD COLUMN IF NOT EXISTS observations text,
  ADD COLUMN IF NOT EXISTS risk_factors text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS usual_medications text;

-- === allergies additions ===
ALTER TABLE public.allergies
  ADD COLUMN IF NOT EXISTS allergen text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS reaction text;

-- === medical_histories table ===
CREATE TABLE IF NOT EXISTS public.medical_histories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  description text NOT NULL,
  approximate_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.medical_histories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "med_hist_select_staff" ON public.medical_histories;
CREATE POLICY "med_hist_select_staff" ON public.medical_histories FOR SELECT
  TO authenticated USING (is_admin() OR is_doctor() OR is_reception());

DROP POLICY IF EXISTS "med_hist_insert_staff" ON public.medical_histories;
CREATE POLICY "med_hist_insert_staff" ON public.medical_histories FOR INSERT
  TO authenticated WITH CHECK (is_admin() OR is_doctor() OR is_reception());

DROP POLICY IF EXISTS "med_hist_update_staff" ON public.medical_histories;
CREATE POLICY "med_hist_update_staff" ON public.medical_histories FOR UPDATE
  TO authenticated USING (is_admin() OR is_doctor() OR is_reception())
  WITH CHECK (is_admin() OR is_doctor() OR is_reception());

DROP POLICY IF EXISTS "med_hist_delete_staff" ON public.medical_histories;
CREATE POLICY "med_hist_delete_staff" ON public.medical_histories FOR DELETE
  TO authenticated USING (is_admin() OR is_doctor());

CREATE INDEX IF NOT EXISTS idx_med_hist_patient_id ON public.medical_histories (patient_id);

-- === surgical_histories table ===
CREATE TABLE IF NOT EXISTS public.surgical_histories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  intervention text NOT NULL,
  operation_date date,
  establishment text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.surgical_histories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "surg_hist_select_staff" ON public.surgical_histories;
CREATE POLICY "surg_hist_select_staff" ON public.surgical_histories FOR SELECT
  TO authenticated USING (is_admin() OR is_doctor() OR is_reception());

DROP POLICY IF EXISTS "surg_hist_insert_staff" ON public.surgical_histories;
CREATE POLICY "surg_hist_insert_staff" ON public.surgical_histories FOR INSERT
  TO authenticated WITH CHECK (is_admin() OR is_doctor() OR is_reception());

DROP POLICY IF EXISTS "surg_hist_update_staff" ON public.surgical_histories;
CREATE POLICY "surg_hist_update_staff" ON public.surgical_histories FOR UPDATE
  TO authenticated USING (is_admin() OR is_doctor() OR is_reception())
  WITH CHECK (is_admin() OR is_doctor() OR is_reception());

DROP POLICY IF EXISTS "surg_hist_delete_staff" ON public.surgical_histories;
CREATE POLICY "surg_hist_delete_staff" ON public.surgical_histories FOR DELETE
  TO authenticated USING (is_admin() OR is_doctor());

CREATE INDEX IF NOT EXISTS idx_surg_hist_patient_id ON public.surgical_histories (patient_id);

-- === family_histories table ===
CREATE TABLE IF NOT EXISTS public.family_histories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  condition_name text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.family_histories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fam_hist_select_staff" ON public.family_histories;
CREATE POLICY "fam_hist_select_staff" ON public.family_histories FOR SELECT
  TO authenticated USING (is_admin() OR is_doctor() OR is_reception());

DROP POLICY IF EXISTS "fam_hist_insert_staff" ON public.family_histories;
CREATE POLICY "fam_hist_insert_staff" ON public.family_histories FOR INSERT
  TO authenticated WITH CHECK (is_admin() OR is_doctor() OR is_reception());

DROP POLICY IF EXISTS "fam_hist_update_staff" ON public.family_histories;
CREATE POLICY "fam_hist_update_staff" ON public.family_histories FOR UPDATE
  TO authenticated USING (is_admin() OR is_doctor() OR is_reception())
  WITH CHECK (is_admin() OR is_doctor() OR is_reception());

DROP POLICY IF EXISTS "fam_hist_delete_staff" ON public.family_histories;
CREATE POLICY "fam_hist_delete_staff" ON public.family_histories FOR DELETE
  TO authenticated USING (is_admin() OR is_doctor());

CREATE INDEX IF NOT EXISTS idx_fam_hist_patient_id ON public.family_histories (patient_id);

-- === pregnancies table ===
CREATE TABLE IF NOT EXISTS public.pregnancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  is_pregnant boolean NOT NULL DEFAULT false,
  gravidity integer,
  parity integer,
  lmp_date date,
  gestational_age_weeks integer,
  expected_term_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pregnancies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "preg_select_staff" ON public.pregnancies;
CREATE POLICY "preg_select_staff" ON public.pregnancies FOR SELECT
  TO authenticated USING (is_admin() OR is_doctor() OR is_reception());

DROP POLICY IF EXISTS "preg_insert_staff" ON public.pregnancies;
CREATE POLICY "preg_insert_staff" ON public.pregnancies FOR INSERT
  TO authenticated WITH CHECK (is_admin() OR is_doctor() OR is_reception());

DROP POLICY IF EXISTS "preg_update_staff" ON public.pregnancies;
CREATE POLICY "preg_update_staff" ON public.pregnancies FOR UPDATE
  TO authenticated USING (is_admin() OR is_doctor() OR is_reception())
  WITH CHECK (is_admin() OR is_doctor() OR is_reception());

DROP POLICY IF EXISTS "preg_delete_staff" ON public.pregnancies;
CREATE POLICY "preg_delete_staff" ON public.pregnancies FOR DELETE
  TO authenticated USING (is_admin() OR is_doctor());

CREATE INDEX IF NOT EXISTS idx_pregnancies_patient_id ON public.pregnancies (patient_id);
