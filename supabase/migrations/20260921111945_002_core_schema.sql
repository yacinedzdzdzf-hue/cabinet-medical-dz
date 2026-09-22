/*
# CMDZ — Core Schema: All Application Tables

Creates all application tables: settings, devices, patients, medical_files,
allergies, chronic_conditions, medications, patient_medications, consultations,
diagnoses, prescriptions, prescription_items, certificates, medical_documents,
follow_ups, appointments, waiting_queue, calls, waiting_settings, services,
invoices, invoice_items, payments, receipts, debts, messages, notifications,
audit_logs, record_versions.

Also creates number-generation helper functions and the audit logging helper.

RLS enabled on every table with role-based policies (ADMIN/DOCTOR/RECEPTION).
*/

-- ============================================================
-- SETTINGS (key-value)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "settings_select_all" ON public.settings;
CREATE POLICY "settings_select_all" ON public.settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "settings_update_admin" ON public.settings;
CREATE POLICY "settings_update_admin" ON public.settings FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "settings_insert_admin" ON public.settings;
CREATE POLICY "settings_insert_admin" ON public.settings FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "settings_delete_admin" ON public.settings;
CREATE POLICY "settings_delete_admin" ON public.settings FOR DELETE TO authenticated USING (public.is_admin());

-- ============================================================
-- DEVICES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_type text NOT NULL CHECK (device_type IN ('SERVER', 'RECEPTION', 'DOCTOR', 'WAITING_MALE', 'WAITING_FEMALE')),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
  last_connection timestamptz,
  ip_address text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "devices_select_all" ON public.devices;
CREATE POLICY "devices_select_all" ON public.devices FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "devices_insert_admin" ON public.devices;
CREATE POLICY "devices_insert_admin" ON public.devices FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "devices_update_admin" ON public.devices;
CREATE POLICY "devices_update_admin" ON public.devices FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "devices_delete_admin" ON public.devices;
CREATE POLICY "devices_delete_admin" ON public.devices FOR DELETE TO authenticated USING (public.is_admin());

-- ============================================================
-- PATIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_number text UNIQUE NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  date_of_birth date,
  sex text CHECK (sex IN ('M', 'F')),
  phone text,
  email text,
  cin text,
  address text,
  wilaya text,
  commune text,
  emergency_contact_name text,
  emergency_contact_phone text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_patients_name ON public.patients (last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON public.patients (phone);
CREATE INDEX IF NOT EXISTS idx_patients_cin ON public.patients (cin);
CREATE INDEX IF NOT EXISTS idx_patients_status ON public.patients (status);
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "patients_select_staff" ON public.patients;
CREATE POLICY "patients_select_staff" ON public.patients FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "patients_insert_staff" ON public.patients;
CREATE POLICY "patients_insert_staff" ON public.patients FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "patients_update_staff" ON public.patients;
CREATE POLICY "patients_update_staff" ON public.patients FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception()) WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "patients_delete_admin" ON public.patients;
CREATE POLICY "patients_delete_admin" ON public.patients FOR DELETE TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.generate_patient_number()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_num integer; new_number text;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(patient_number FROM 5) AS integer)), 0) + 1
  INTO next_num FROM public.patients WHERE patient_number LIKE 'PAT-%';
  new_number := 'PAT-' || lpad(next_num::text, 6, '0');
  RETURN new_number;
END;
$$;

-- ============================================================
-- MEDICAL FILES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.medical_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_number text UNIQUE NOT NULL,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  blood_type text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_medical_files_patient ON public.medical_files (patient_id);
ALTER TABLE public.medical_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "medical_files_select_staff" ON public.medical_files;
CREATE POLICY "medical_files_select_staff" ON public.medical_files FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "medical_files_insert_staff" ON public.medical_files;
CREATE POLICY "medical_files_insert_staff" ON public.medical_files FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "medical_files_update_staff" ON public.medical_files;
CREATE POLICY "medical_files_update_staff" ON public.medical_files FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception()) WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "medical_files_delete_admin" ON public.medical_files;
CREATE POLICY "medical_files_delete_admin" ON public.medical_files FOR DELETE TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.generate_file_number()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_num integer; new_number text;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(file_number FROM 4) AS integer)), 0) + 1
  INTO next_num FROM public.medical_files WHERE file_number LIKE 'DM-%';
  new_number := 'DM-' || lpad(next_num::text, 6, '0');
  RETURN new_number;
END;
$$;

-- ============================================================
-- ALLERGIES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.allergies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  name text NOT NULL,
  severity text CHECK (severity IN ('mild', 'moderate', 'severe')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_allergies_patient ON public.allergies (patient_id);
ALTER TABLE public.allergies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allergies_select_staff" ON public.allergies;
CREATE POLICY "allergies_select_staff" ON public.allergies FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "allergies_insert_staff" ON public.allergies;
CREATE POLICY "allergies_insert_staff" ON public.allergies FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "allergies_update_staff" ON public.allergies;
CREATE POLICY "allergies_update_staff" ON public.allergies FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception()) WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "allergies_delete_staff" ON public.allergies;
CREATE POLICY "allergies_delete_staff" ON public.allergies FOR DELETE TO authenticated USING (public.is_admin() OR public.is_doctor());

-- ============================================================
-- CHRONIC CONDITIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chronic_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  name text NOT NULL,
  diagnosed_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chronic_patient ON public.chronic_conditions (patient_id);
ALTER TABLE public.chronic_conditions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chronic_select_staff" ON public.chronic_conditions;
CREATE POLICY "chronic_select_staff" ON public.chronic_conditions FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "chronic_insert_staff" ON public.chronic_conditions;
CREATE POLICY "chronic_insert_staff" ON public.chronic_conditions FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "chronic_update_staff" ON public.chronic_conditions;
CREATE POLICY "chronic_update_staff" ON public.chronic_conditions FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception()) WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "chronic_delete_staff" ON public.chronic_conditions;
CREATE POLICY "chronic_delete_staff" ON public.chronic_conditions FOR DELETE TO authenticated USING (public.is_admin() OR public.is_doctor());

-- ============================================================
-- MEDICATIONS (catalog)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_name text NOT NULL,
  dci text,
  active_ingredient text,
  strength text,
  form text,
  manufacturer text,
  is_favorite boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meds_name ON public.medications (commercial_name);
CREATE INDEX IF NOT EXISTS idx_meds_dci ON public.medications (dci);
ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "meds_select_staff" ON public.medications;
CREATE POLICY "meds_select_staff" ON public.medications FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "meds_insert_staff" ON public.medications;
CREATE POLICY "meds_insert_staff" ON public.medications FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "meds_update_staff" ON public.medications;
CREATE POLICY "meds_update_staff" ON public.medications FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception()) WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "meds_delete_staff" ON public.medications;
CREATE POLICY "meds_delete_staff" ON public.medications FOR DELETE TO authenticated USING (public.is_admin() OR public.is_doctor());

-- ============================================================
-- PATIENT MEDICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.patient_medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  medication_id uuid REFERENCES public.medications(id) ON DELETE SET NULL,
  name text NOT NULL,
  dose text,
  frequency text,
  duration text,
  route text,
  instructions text,
  start_date date,
  end_date date,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_patient_meds_patient ON public.patient_medications (patient_id);
ALTER TABLE public.patient_medications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "patient_meds_select_staff" ON public.patient_medications;
CREATE POLICY "patient_meds_select_staff" ON public.patient_medications FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "patient_meds_insert_staff" ON public.patient_medications;
CREATE POLICY "patient_meds_insert_staff" ON public.patient_medications FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "patient_meds_update_staff" ON public.patient_medications;
CREATE POLICY "patient_meds_update_staff" ON public.patient_medications FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception()) WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "patient_meds_delete_staff" ON public.patient_medications;
CREATE POLICY "patient_meds_delete_staff" ON public.patient_medications FOR DELETE TO authenticated USING (public.is_admin() OR public.is_doctor());

-- ============================================================
-- APPOINTMENTS (needed before consultations FK)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  appointment_date date NOT NULL,
  appointment_time time NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  reason text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'arrived', 'no_show', 'cancelled', 'completed')),
  notes text,
  checked_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appts_date ON public.appointments (appointment_date);
CREATE INDEX IF NOT EXISTS idx_appts_patient ON public.appointments (patient_id);
CREATE INDEX IF NOT EXISTS idx_appts_doctor ON public.appointments (doctor_id);
CREATE INDEX IF NOT EXISTS idx_appts_status ON public.appointments (status);
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "appts_select_staff" ON public.appointments;
CREATE POLICY "appts_select_staff" ON public.appointments FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "appts_insert_staff" ON public.appointments;
CREATE POLICY "appts_insert_staff" ON public.appointments FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "appts_update_staff" ON public.appointments;
CREATE POLICY "appts_update_staff" ON public.appointments FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception()) WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "appts_delete_staff" ON public.appointments;
CREATE POLICY "appts_delete_staff" ON public.appointments FOR DELETE TO authenticated USING (public.is_admin() OR public.is_reception());

-- ============================================================
-- WAITING QUEUE (needed before consultations FK)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.waiting_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  queue_type text NOT NULL CHECK (queue_type IN ('H', 'F')),
  queue_number text NOT NULL,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'called', 'in_consultation', 'completed', 'skipped', 'returned')),
  called_at timestamptz,
  entered_consultation_at timestamptz,
  completed_at timestamptz,
  doctor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waiting_queue_number ON public.waiting_queue (queue_type, queue_number);
CREATE INDEX IF NOT EXISTS idx_waiting_queue_status ON public.waiting_queue (status);
CREATE INDEX IF NOT EXISTS idx_waiting_queue_type ON public.waiting_queue (queue_type);
ALTER TABLE public.waiting_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "waiting_queue_select_all" ON public.waiting_queue;
CREATE POLICY "waiting_queue_select_all" ON public.waiting_queue FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "waiting_queue_insert_staff" ON public.waiting_queue;
CREATE POLICY "waiting_queue_insert_staff" ON public.waiting_queue FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "waiting_queue_update_staff" ON public.waiting_queue;
CREATE POLICY "waiting_queue_update_staff" ON public.waiting_queue FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception()) WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "waiting_queue_delete_admin" ON public.waiting_queue;
CREATE POLICY "waiting_queue_delete_admin" ON public.waiting_queue FOR DELETE TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.generate_queue_number(p_queue_type text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_num integer; new_number text;
BEGIN
  SELECT COALESCE(MAX(CAST(queue_number AS integer)), 0) + 1
  INTO next_num FROM public.waiting_queue WHERE queue_type = p_queue_type;
  new_number := p_queue_type || '-' || lpad(next_num::text, 3, '0');
  RETURN new_number;
END;
$$;

-- ============================================================
-- CONSULTATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  medical_file_id uuid REFERENCES public.medical_files(id) ON DELETE SET NULL,
  doctor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  queue_id uuid REFERENCES public.waiting_queue(id) ON DELETE SET NULL,
  chief_complaint text,
  symptoms text,
  medical_history text,
  surgical_history text,
  family_history text,
  temperature numeric,
  blood_pressure_systolic integer,
  blood_pressure_diastolic integer,
  heart_rate integer,
  respiratory_rate integer,
  spo2 numeric,
  weight numeric,
  height numeric,
  bmi numeric,
  diagnosis text,
  icd_code text,
  treatment text,
  recommendations text,
  notes text,
  follow_up_date date,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consultations_patient ON public.consultations (patient_id);
CREATE INDEX IF NOT EXISTS idx_consultations_doctor ON public.consultations (doctor_id);
CREATE INDEX IF NOT EXISTS idx_consultations_status ON public.consultations (status);
ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "consultations_select_staff" ON public.consultations;
CREATE POLICY "consultations_select_staff" ON public.consultations FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "consultations_insert_doctor" ON public.consultations;
CREATE POLICY "consultations_insert_doctor" ON public.consultations FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor());
DROP POLICY IF EXISTS "consultations_update_doctor" ON public.consultations;
CREATE POLICY "consultations_update_doctor" ON public.consultations FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_doctor()) WITH CHECK (public.is_admin() OR public.is_doctor());
DROP POLICY IF EXISTS "consultations_delete_admin" ON public.consultations;
CREATE POLICY "consultations_delete_admin" ON public.consultations FOR DELETE TO authenticated USING (public.is_admin());

-- ============================================================
-- DIAGNOSES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.diagnoses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES public.consultations(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  name text NOT NULL,
  icd_code text,
  type text CHECK (type IN ('primary', 'secondary', 'differential')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_diagnoses_consultation ON public.diagnoses (consultation_id);
CREATE INDEX IF NOT EXISTS idx_diagnoses_patient ON public.diagnoses (patient_id);
ALTER TABLE public.diagnoses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "diagnoses_select_staff" ON public.diagnoses;
CREATE POLICY "diagnoses_select_staff" ON public.diagnoses FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "diagnoses_insert_doctor" ON public.diagnoses;
CREATE POLICY "diagnoses_insert_doctor" ON public.diagnoses FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor());
DROP POLICY IF EXISTS "diagnoses_update_doctor" ON public.diagnoses;
CREATE POLICY "diagnoses_update_doctor" ON public.diagnoses FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_doctor()) WITH CHECK (public.is_admin() OR public.is_doctor());
DROP POLICY IF EXISTS "diagnoses_delete_doctor" ON public.diagnoses;
CREATE POLICY "diagnoses_delete_doctor" ON public.diagnoses FOR DELETE TO authenticated USING (public.is_admin() OR public.is_doctor());

-- ============================================================
-- PRESCRIPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_number text UNIQUE NOT NULL,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  medical_file_id uuid REFERENCES public.medical_files(id) ON DELETE SET NULL,
  consultation_id uuid REFERENCES public.consultations(id) ON DELETE SET NULL,
  doctor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON public.prescriptions (patient_id);
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "prescriptions_select_staff" ON public.prescriptions;
CREATE POLICY "prescriptions_select_staff" ON public.prescriptions FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "prescriptions_insert_doctor" ON public.prescriptions;
CREATE POLICY "prescriptions_insert_doctor" ON public.prescriptions FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor());
DROP POLICY IF EXISTS "prescriptions_update_doctor" ON public.prescriptions;
CREATE POLICY "prescriptions_update_doctor" ON public.prescriptions FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_doctor()) WITH CHECK (public.is_admin() OR public.is_doctor());
DROP POLICY IF EXISTS "prescriptions_delete_doctor" ON public.prescriptions;
CREATE POLICY "prescriptions_delete_doctor" ON public.prescriptions FOR DELETE TO authenticated USING (public.is_admin() OR public.is_doctor());

-- ============================================================
-- PRESCRIPTION ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.prescription_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  medication_id uuid REFERENCES public.medications(id) ON DELETE SET NULL,
  name text NOT NULL,
  dci text,
  strength text,
  form text,
  dose text,
  frequency text,
  duration text,
  route text,
  timing text,
  instructions text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_presc_items_prescription ON public.prescription_items (prescription_id);
ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "presc_items_select_staff" ON public.prescription_items;
CREATE POLICY "presc_items_select_staff" ON public.prescription_items FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "presc_items_insert_doctor" ON public.prescription_items;
CREATE POLICY "presc_items_insert_doctor" ON public.prescription_items FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor());
DROP POLICY IF EXISTS "presc_items_update_doctor" ON public.prescription_items;
CREATE POLICY "presc_items_update_doctor" ON public.prescription_items FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_doctor()) WITH CHECK (public.is_admin() OR public.is_doctor());
DROP POLICY IF EXISTS "presc_items_delete_doctor" ON public.prescription_items;
CREATE POLICY "presc_items_delete_doctor" ON public.prescription_items FOR DELETE TO authenticated USING (public.is_admin() OR public.is_doctor());

-- ============================================================
-- CERTIFICATES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_number text UNIQUE NOT NULL,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  consultation_id uuid REFERENCES public.consultations(id) ON DELETE SET NULL,
  doctor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('medical', 'sick_leave', 'fitness', 'aptitude', 'non_contraindication', 'custom')),
  title text,
  body text,
  days_off integer,
  start_date date,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_certificates_patient ON public.certificates (patient_id);
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "certificates_select_staff" ON public.certificates;
CREATE POLICY "certificates_select_staff" ON public.certificates FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "certificates_insert_doctor" ON public.certificates;
CREATE POLICY "certificates_insert_doctor" ON public.certificates FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor());
DROP POLICY IF EXISTS "certificates_update_doctor" ON public.certificates;
CREATE POLICY "certificates_update_doctor" ON public.certificates FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_doctor()) WITH CHECK (public.is_admin() OR public.is_doctor());
DROP POLICY IF EXISTS "certificates_delete_doctor" ON public.certificates;
CREATE POLICY "certificates_delete_doctor" ON public.certificates FOR DELETE TO authenticated USING (public.is_admin() OR public.is_doctor());

-- ============================================================
-- MEDICAL DOCUMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.medical_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  medical_file_id uuid REFERENCES public.medical_files(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  file_type text NOT NULL CHECK (file_type IN ('xray', 'radiography', 'lab_result', 'report', 'imaging', 'image', 'certificate', 'administrative', 'other')),
  file_path text NOT NULL,
  file_size bigint,
  mime_type text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_med_docs_patient ON public.medical_documents (patient_id);
ALTER TABLE public.medical_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "med_docs_select_staff" ON public.medical_documents;
CREATE POLICY "med_docs_select_staff" ON public.medical_documents FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "med_docs_insert_staff" ON public.medical_documents;
CREATE POLICY "med_docs_insert_staff" ON public.medical_documents FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "med_docs_update_staff" ON public.medical_documents;
CREATE POLICY "med_docs_update_staff" ON public.medical_documents FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception()) WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "med_docs_delete_staff" ON public.medical_documents;
CREATE POLICY "med_docs_delete_staff" ON public.medical_documents FOR DELETE TO authenticated USING (public.is_admin() OR public.is_doctor());

-- ============================================================
-- FOLLOW-UPS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  consultation_id uuid REFERENCES public.consultations(id) ON DELETE SET NULL,
  doctor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  follow_up_date date NOT NULL,
  reason text,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_followups_patient ON public.follow_ups (patient_id);
CREATE INDEX IF NOT EXISTS idx_followups_date ON public.follow_ups (follow_up_date);
CREATE INDEX IF NOT EXISTS idx_followups_status ON public.follow_ups (status);
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "followups_select_staff" ON public.follow_ups;
CREATE POLICY "followups_select_staff" ON public.follow_ups FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "followups_insert_staff" ON public.follow_ups;
CREATE POLICY "followups_insert_staff" ON public.follow_ups FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "followups_update_staff" ON public.follow_ups;
CREATE POLICY "followups_update_staff" ON public.follow_ups FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception()) WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "followups_delete_staff" ON public.follow_ups;
CREATE POLICY "followups_delete_staff" ON public.follow_ups FOR DELETE TO authenticated USING (public.is_admin() OR public.is_doctor());

-- ============================================================
-- SERVICES (billable)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  unit_price numeric(12, 2) NOT NULL DEFAULT 0,
  tva_rate numeric(5, 2) NOT NULL DEFAULT 0,
  category text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "services_select_staff" ON public.services;
CREATE POLICY "services_select_staff" ON public.services FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "services_insert_admin" ON public.services;
CREATE POLICY "services_insert_admin" ON public.services FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "services_update_admin" ON public.services;
CREATE POLICY "services_update_admin" ON public.services FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "services_delete_admin" ON public.services;
CREATE POLICY "services_delete_admin" ON public.services FOR DELETE TO authenticated USING (public.is_admin());

-- ============================================================
-- CALLS (voice call records)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id uuid NOT NULL REFERENCES public.waiting_queue(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  queue_number text NOT NULL,
  patient_name text NOT NULL,
  call_text text NOT NULL,
  called_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'called' CHECK (status IN ('called', 'recall', 'skipped')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calls_created ON public.calls (created_at DESC);
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "calls_select_all" ON public.calls;
CREATE POLICY "calls_select_all" ON public.calls FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "calls_insert_staff" ON public.calls;
CREATE POLICY "calls_insert_staff" ON public.calls FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "calls_delete_admin" ON public.calls;
CREATE POLICY "calls_delete_admin" ON public.calls FOR DELETE TO authenticated USING (public.is_admin());

-- ============================================================
-- WAITING SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.waiting_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_patient_name boolean NOT NULL DEFAULT true,
  voice_enabled boolean NOT NULL DEFAULT true,
  voice_volume real NOT NULL DEFAULT 1.0,
  voice_rate real NOT NULL DEFAULT 1.0,
  voice_pitch real NOT NULL DEFAULT 1.0,
  voice_repeat_count integer NOT NULL DEFAULT 1,
  voice_lang text NOT NULL DEFAULT 'fr-FR',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.waiting_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "waiting_settings_select_all" ON public.waiting_settings;
CREATE POLICY "waiting_settings_select_all" ON public.waiting_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "waiting_settings_update_staff" ON public.waiting_settings;
CREATE POLICY "waiting_settings_update_staff" ON public.waiting_settings FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_reception()) WITH CHECK (public.is_admin() OR public.is_reception());
DROP POLICY IF EXISTS "waiting_settings_insert_staff" ON public.waiting_settings;
CREATE POLICY "waiting_settings_insert_staff" ON public.waiting_settings FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_reception());

-- ============================================================
-- INVOICES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE NOT NULL,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  medical_file_id uuid REFERENCES public.medical_files(id) ON DELETE SET NULL,
  consultation_id uuid REFERENCES public.consultations(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subtotal numeric(12, 2) NOT NULL DEFAULT 0,
  discount numeric(12, 2) NOT NULL DEFAULT 0,
  tva_amount numeric(12, 2) NOT NULL DEFAULT 0,
  total numeric(12, 2) NOT NULL DEFAULT 0,
  paid_amount numeric(12, 2) NOT NULL DEFAULT 0,
  remaining_amount numeric(12, 2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partially_paid', 'paid', 'cancelled')),
  cancellation_reason text,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_patient ON public.invoices (patient_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices (status);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invoices_select_staff" ON public.invoices;
CREATE POLICY "invoices_select_staff" ON public.invoices FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "invoices_insert_staff" ON public.invoices;
CREATE POLICY "invoices_insert_staff" ON public.invoices FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "invoices_update_staff" ON public.invoices;
CREATE POLICY "invoices_update_staff" ON public.invoices FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception()) WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "invoices_delete_admin" ON public.invoices;
CREATE POLICY "invoices_delete_admin" ON public.invoices FOR DELETE TO authenticated USING (public.is_admin());

-- ============================================================
-- INVOICE ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(12, 2) NOT NULL DEFAULT 0,
  discount numeric(12, 2) NOT NULL DEFAULT 0,
  tva_rate numeric(5, 2) NOT NULL DEFAULT 0,
  total numeric(12, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items (invoice_id);
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invoice_items_select_staff" ON public.invoice_items;
CREATE POLICY "invoice_items_select_staff" ON public.invoice_items FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "invoice_items_insert_staff" ON public.invoice_items;
CREATE POLICY "invoice_items_insert_staff" ON public.invoice_items FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "invoice_items_update_staff" ON public.invoice_items;
CREATE POLICY "invoice_items_update_staff" ON public.invoice_items FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception()) WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "invoice_items_delete_staff" ON public.invoice_items;
CREATE POLICY "invoice_items_delete_staff" ON public.invoice_items FOR DELETE TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number text UNIQUE NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('cash', 'card', 'guarantee_card')),
  received_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON public.payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_patient ON public.payments (patient_id);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payments_select_staff" ON public.payments;
CREATE POLICY "payments_select_staff" ON public.payments FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "payments_insert_staff" ON public.payments;
CREATE POLICY "payments_insert_staff" ON public.payments FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "payments_delete_admin" ON public.payments;
CREATE POLICY "payments_delete_admin" ON public.payments FOR DELETE TO authenticated USING (public.is_admin());

-- ============================================================
-- RECEIPTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text UNIQUE NOT NULL,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  method text NOT NULL,
  remaining_balance numeric(12, 2) NOT NULL DEFAULT 0,
  issued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_receipts_patient ON public.receipts (patient_id);
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "receipts_select_staff" ON public.receipts;
CREATE POLICY "receipts_select_staff" ON public.receipts FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "receipts_insert_staff" ON public.receipts;
CREATE POLICY "receipts_insert_staff" ON public.receipts FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "receipts_delete_admin" ON public.receipts;
CREATE POLICY "receipts_delete_admin" ON public.receipts FOR DELETE TO authenticated USING (public.is_admin());

-- ============================================================
-- DEBTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  original_amount numeric(12, 2) NOT NULL DEFAULT 0,
  paid_amount numeric(12, 2) NOT NULL DEFAULT 0,
  remaining_amount numeric(12, 2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_debts_patient ON public.debts (patient_id);
CREATE INDEX IF NOT EXISTS idx_debts_status ON public.debts (status);
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "debts_select_staff" ON public.debts;
CREATE POLICY "debts_select_staff" ON public.debts FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "debts_insert_staff" ON public.debts;
CREATE POLICY "debts_insert_staff" ON public.debts FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "debts_update_staff" ON public.debts;
CREATE POLICY "debts_update_staff" ON public.debts FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception()) WITH CHECK (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "debts_delete_admin" ON public.debts;
CREATE POLICY "debts_delete_admin" ON public.debts FOR DELETE TO authenticated USING (public.is_admin());

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON public.messages (recipient_id, is_read);
CREATE INDEX IF NOT EXISTS idx_messages_created ON public.messages (created_at DESC);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "messages_select_involved" ON public.messages;
CREATE POLICY "messages_select_involved" ON public.messages FOR SELECT TO authenticated USING (auth.uid() = sender_id OR auth.uid() = recipient_id);
DROP POLICY IF EXISTS "messages_insert_self" ON public.messages;
CREATE POLICY "messages_insert_self" ON public.messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = sender_id);
DROP POLICY IF EXISTS "messages_update_recipient" ON public.messages;
CREATE POLICY "messages_update_recipient" ON public.messages FOR UPDATE TO authenticated USING (auth.uid() = recipient_id) WITH CHECK (auth.uid() = recipient_id);
DROP POLICY IF EXISTS "messages_delete_sender" ON public.messages;
CREATE POLICY "messages_delete_sender" ON public.messages FOR DELETE TO authenticated USING (auth.uid() = sender_id);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  type text NOT NULL DEFAULT 'info',
  is_read boolean NOT NULL DEFAULT false,
  link text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (user_id, is_read);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "notifications_insert_staff" ON public.notifications;
CREATE POLICY "notifications_insert_staff" ON public.notifications FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR public.is_admin());
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;
CREATE POLICY "notifications_delete_own" ON public.notifications FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name text,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  entity_description text,
  details jsonb DEFAULT '{}'::jsonb,
  ip_address text,
  device_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON public.audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON public.audit_logs (action);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_select_admin" ON public.audit_logs;
CREATE POLICY "audit_select_admin" ON public.audit_logs FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "audit_insert_staff" ON public.audit_logs;
CREATE POLICY "audit_insert_staff" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "audit_delete_admin" ON public.audit_logs;
CREATE POLICY "audit_delete_admin" ON public.audit_logs FOR DELETE TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.log_audit(
  p_action text, p_entity_type text DEFAULT NULL, p_entity_id uuid DEFAULT NULL,
  p_entity_description text DEFAULT NULL, p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_name text;
BEGIN
  SELECT full_name INTO v_user_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, entity_description, details)
  VALUES (auth.uid(), v_user_name, p_action, p_entity_type, p_entity_id, p_entity_description, p_details);
END;
$$;

-- ============================================================
-- RECORD VERSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.record_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('consultation', 'diagnosis', 'prescription', 'medical_note')),
  entity_id uuid NOT NULL,
  version_number integer NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_versions_entity ON public.record_versions (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_versions_created ON public.record_versions (created_at DESC);
ALTER TABLE public.record_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "versions_select_staff" ON public.record_versions;
CREATE POLICY "versions_select_staff" ON public.record_versions FOR SELECT TO authenticated USING (public.is_admin() OR public.is_doctor() OR public.is_reception());
DROP POLICY IF EXISTS "versions_insert_staff" ON public.record_versions;
CREATE POLICY "versions_insert_staff" ON public.record_versions FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor());
DROP POLICY IF EXISTS "versions_delete_admin" ON public.record_versions;
CREATE POLICY "versions_delete_admin" ON public.record_versions FOR DELETE TO authenticated USING (public.is_admin());

-- ============================================================
-- STORAGE BUCKET for medical documents (private)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('medical-documents', 'medical-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "med_docs_storage_select" ON storage.objects;
CREATE POLICY "med_docs_storage_select" ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'medical-documents' AND (public.is_admin() OR public.is_doctor() OR public.is_reception()));

DROP POLICY IF EXISTS "med_docs_storage_insert" ON storage.objects;
CREATE POLICY "med_docs_storage_insert" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'medical-documents' AND (public.is_admin() OR public.is_doctor() OR public.is_reception()));

DROP POLICY IF EXISTS "med_docs_storage_update" ON storage.objects;
CREATE POLICY "med_docs_storage_update" ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'medical-documents' AND (public.is_admin() OR public.is_doctor() OR public.is_reception()))
  WITH CHECK (bucket_id = 'medical-documents' AND (public.is_admin() OR public.is_doctor() OR public.is_reception()));

DROP POLICY IF EXISTS "med_docs_storage_delete" ON storage.objects;
CREATE POLICY "med_docs_storage_delete" ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'medical-documents' AND (public.is_admin() OR public.is_doctor()));
