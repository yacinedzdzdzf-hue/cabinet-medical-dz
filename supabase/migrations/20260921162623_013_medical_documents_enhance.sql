/*
# CMDZ — Enhance medical documents and add lab results + radiology exams

1. medical_documents table changes:
   - Add `document_type` (text) — finer classification: lab_result, blood_test, urinalysis, ecg, xray, ct_scan, mri, ultrasound, report, hospital_doc, certificate, other
   - Add `document_date` (date) — date the document was issued/performed
   - Add `archived_at` (timestamptz) — soft archive timestamp
   - Add `uploaded_by_name` (text) — denormalized uploader name for display

2. New table: lab_results
   - Stores lab analysis results with classification and optional file link
   - Fields: id, patient_id, medical_file_id, lab_type, lab_subtype, result_date, 
     comment, file_path, document_id (link to medical_documents), uploaded_by, created_at

3. New table: radiology_exams
   - Stores radiology/imaging exams with type, indication, report, and file link
   - Fields: id, patient_id, medical_file_id, exam_type, exam_date, indication,
     report, file_path, document_id, doctor_name, comment, uploaded_by, created_at

4. RLS policies on new tables:
   - lab_results: SELECT/INSERT/UPDATE for admin/doctor/reception; DELETE for admin/doctor
   - radiology_exams: SELECT/INSERT/UPDATE for admin/doctor/reception; DELETE for admin/doctor

5. Indexes on patient_id for fast lookup
*/

-- === medical_documents enhancements ===
ALTER TABLE public.medical_documents 
  ADD COLUMN IF NOT EXISTS document_type text DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS document_date date,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS uploaded_by_name text;

-- Update existing file_type values to also populate document_type
UPDATE public.medical_documents 
  SET document_type = file_type 
  WHERE document_type = 'other' AND file_type IS NOT NULL;

-- === lab_results table ===
CREATE TABLE IF NOT EXISTS public.lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  medical_file_id uuid REFERENCES public.medical_files(id) ON DELETE SET NULL,
  lab_type text NOT NULL DEFAULT 'other',
  lab_subtype text,
  result_date date NOT NULL DEFAULT CURRENT_DATE,
  comment text,
  file_path text,
  document_id uuid REFERENCES public.medical_documents(id) ON DELETE SET NULL,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lab_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lab_results_select_staff" ON public.lab_results;
CREATE POLICY "lab_results_select_staff" ON public.lab_results FOR SELECT
  TO authenticated USING (is_admin() OR is_doctor() OR is_reception());

DROP POLICY IF EXISTS "lab_results_insert_staff" ON public.lab_results;
CREATE POLICY "lab_results_insert_staff" ON public.lab_results FOR INSERT
  TO authenticated WITH CHECK (is_admin() OR is_doctor() OR is_reception());

DROP POLICY IF EXISTS "lab_results_update_staff" ON public.lab_results;
CREATE POLICY "lab_results_update_staff" ON public.lab_results FOR UPDATE
  TO authenticated USING (is_admin() OR is_doctor() OR is_reception())
  WITH CHECK (is_admin() OR is_doctor() OR is_reception());

DROP POLICY IF EXISTS "lab_results_delete_staff" ON public.lab_results;
CREATE POLICY "lab_results_delete_staff" ON public.lab_results FOR DELETE
  TO authenticated USING (is_admin() OR is_doctor());

CREATE INDEX IF NOT EXISTS idx_lab_results_patient_id ON public.lab_results (patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_results_result_date ON public.lab_results (result_date);

-- === radiology_exams table ===
CREATE TABLE IF NOT EXISTS public.radiology_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  medical_file_id uuid REFERENCES public.medical_files(id) ON DELETE SET NULL,
  exam_type text NOT NULL DEFAULT 'other',
  exam_date date NOT NULL DEFAULT CURRENT_DATE,
  indication text,
  report text,
  file_path text,
  document_id uuid REFERENCES public.medical_documents(id) ON DELETE SET NULL,
  doctor_name text,
  comment text,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.radiology_exams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rad_exams_select_staff" ON public.radiology_exams;
CREATE POLICY "rad_exams_select_staff" ON public.radiology_exams FOR SELECT
  TO authenticated USING (is_admin() OR is_doctor() OR is_reception());

DROP POLICY IF EXISTS "rad_exams_insert_staff" ON public.radiology_exams;
CREATE POLICY "rad_exams_insert_staff" ON public.radiology_exams FOR INSERT
  TO authenticated WITH CHECK (is_admin() OR is_doctor() OR is_reception());

DROP POLICY IF EXISTS "rad_exams_update_staff" ON public.radiology_exams;
CREATE POLICY "rad_exams_update_staff" ON public.radiology_exams FOR UPDATE
  TO authenticated USING (is_admin() OR is_doctor() OR is_reception())
  WITH CHECK (is_admin() OR is_doctor() OR is_reception());

DROP POLICY IF EXISTS "rad_exams_delete_staff" ON public.radiology_exams;
CREATE POLICY "rad_exams_delete_staff" ON public.radiology_exams FOR DELETE
  TO authenticated USING (is_admin() OR is_doctor());

CREATE INDEX IF NOT EXISTS idx_rad_exams_patient_id ON public.radiology_exams (patient_id);
CREATE INDEX IF NOT EXISTS idx_rad_exams_exam_date ON public.radiology_exams (exam_date);

-- === Add FK from medical_documents to profiles for uploaded_by ===
-- (already has uploaded_by but no FK constraint)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'med_docs_uploaded_by_fkey'
  ) THEN
    ALTER TABLE public.medical_documents
      ADD CONSTRAINT med_docs_uploaded_by_fkey
      FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
