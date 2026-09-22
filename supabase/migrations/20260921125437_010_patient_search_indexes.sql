/*
# CMDZ — Add search indexes for patient search performance

Adds trigram-friendly indexes for searching patients by name, phone, CIN, patient_number.
Also adds an index on medical_files.file_number for dossier search.
*/

-- Add ilike-friendly indexes (Supabase/Postgres uses pg_trgm for fast ILIKE)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes for fast ILIKE search on patients
CREATE INDEX IF NOT EXISTS idx_patients_first_name_trgm ON public.patients USING gin (first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_patients_last_name_trgm ON public.patients USING gin (last_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_patients_patient_number_trgm ON public.patients USING gin (patient_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_patients_cin_trgm ON public.patients USING gin (cin gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_patients_phone_trgm ON public.patients USING gin (phone gin_trgm_ops);

-- Index on medical_files.file_number for dossier search
CREATE INDEX IF NOT EXISTS idx_medical_files_file_number ON public.medical_files (file_number);
CREATE INDEX IF NOT EXISTS idx_medical_files_patient_id ON public.medical_files (patient_id);
