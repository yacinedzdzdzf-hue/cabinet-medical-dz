export type Role = 'ADMIN' | 'DOCTOR' | 'RECEPTION' | 'WAITING_MALE' | 'WAITING_FEMALE';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  active: boolean;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface Patient {
  id: string;
  patient_number: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  sex: 'M' | 'F' | null;
  phone: string | null;
  email: string | null;
  cin: string | null;
  address: string | null;
  wilaya: string | null;
  commune: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  marital_status: string | null;
  status: 'active' | 'archived';
  archived_at: string | null;
  archived_by: string | null;
  archived_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface MedicalFile {
  id: string;
  file_number: string;
  patient_id: string;
  blood_type: string | null;
  notes: string | null;
  marital_status: string | null;
  observations: string | null;
  risk_factors: string[] | null;
  usual_medications: string | null;
  created_at: string;
  updated_at: string;
  patient?: Patient;
}

export interface Allergy {
  id: string;
  patient_id: string;
  name: string;
  allergen: string | null;
  category: string | null;
  reaction: string | null;
  severity: 'mild' | 'moderate' | 'severe' | 'unknown' | null;
  notes: string | null;
  created_at: string;
}

export interface ChronicCondition {
  id: string;
  patient_id: string;
  name: string;
  diagnosed_date: string | null;
  notes: string | null;
  created_at: string;
}

export interface Medication {
  id: string;
  code: string | null;
  commercial_name: string;
  dci: string | null;
  active_ingredient: string | null;
  strength: string | null;
  form: string | null;
  pharmaceutical_form: string | null;
  manufacturer: string | null;
  laboratory: string | null;
  route: string | null;
  default_dosage: string | null;
  default_frequency: string | null;
  default_duration: string | null;
  instructions: string | null;
  is_favorite: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PatientMedication {
  id: string;
  patient_id: string;
  medication_id: string | null;
  name: string;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  route: string | null;
  instructions: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  created_at: string;
}

export interface Consultation {
  id: string;
  patient_id: string;
  medical_file_id: string | null;
  doctor_id: string | null;
  queue_id: string | null;
  appointment_id: string | null;
  chief_complaint: string | null;
  symptoms: string | null;
  medical_history: string | null;
  surgical_history: string | null;
  family_history: string | null;
  temperature: number | null;
  blood_pressure_systolic: number | null;
  blood_pressure_diastolic: number | null;
  heart_rate: number | null;
  respiratory_rate: number | null;
  spo2: number | null;
  weight: number | null;
  height: number | null;
  bmi: number | null;
  diagnosis: string | null;
  icd_code: string | null;
  treatment: string | null;
  recommendations: string | null;
  notes: string | null;
  follow_up_date: string | null;
  status: 'in_progress' | 'completed' | 'cancelled';
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  patient?: Patient;
  doctor?: Profile;
  appointment?: Appointment;
}

export interface Diagnosis {
  id: string;
  consultation_id: string;
  patient_id: string;
  name: string;
  icd_code: string | null;
  type: 'primary' | 'secondary' | 'differential' | null;
  notes: string | null;
  created_at: string;
}

export interface Prescription {
  id: string;
  prescription_number: string;
  patient_id: string;
  medical_file_id: string | null;
  consultation_id: string | null;
  doctor_id: string | null;
  notes: string | null;
  /** Nom imprimé sur cette ordonnance. Vide : on utilise le nom réel du patient. */
  patient_display_name: string | null;
  /** Date choisie par le médecin. Vide : on utilise la date de création. */
  prescription_date: string | null;
  created_at: string;
  /** Date et heure de la dernière modification réelle. */
  updated_at: string | null;
  patient?: Patient;
  doctor?: Profile;
  prescription_items?: PrescriptionItem[];
}

export interface PrescriptionItem {
  id: string;
  prescription_id: string;
  medication_id: string | null;
  name: string;
  dci: string | null;
  strength: string | null;
  form: string | null;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  route: string | null;
  timing: string | null;
  instructions: string | null;
  qsp: string | null;
  sort_order: number;
  created_at: string;
}

export interface Certificate {
  id: string;
  certificate_number: string;
  patient_id: string;
  consultation_id: string | null;
  doctor_id: string | null;
  type: 'medical' | 'sick_leave' | 'fitness' | 'aptitude' | 'non_contraindication' | 'custom';
  title: string | null;
  body: string | null;
  days_off: number | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  patient?: Patient;
}

export interface MedicalDocument {
  id: string;
  patient_id: string;
  medical_file_id: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  name: string;
  description: string | null;
  file_type: 'xray' | 'radiography' | 'lab_result' | 'report' | 'imaging' | 'image' | 'certificate' | 'administrative' | 'other';
  document_type: string | null;
  document_date: string | null;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  status: 'active' | 'archived';
  archived_at: string | null;
  created_at: string;
}

export interface LabResult {
  id: string;
  patient_id: string;
  medical_file_id: string | null;
  lab_type: string;
  lab_subtype: string | null;
  result_date: string;
  comment: string | null;
  file_path: string | null;
  document_id: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface RadiologyExam {
  id: string;
  patient_id: string;
  medical_file_id: string | null;
  exam_type: string;
  exam_date: string;
  indication: string | null;
  report: string | null;
  file_path: string | null;
  document_id: string | null;
  doctor_name: string | null;
  comment: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface FollowUp {
  id: string;
  patient_id: string;
  consultation_id: string | null;
  doctor_id: string | null;
  follow_up_date: string;
  reason: string | null;
  notes: string | null;
  status: 'pending' | 'completed' | 'cancelled';
  created_at: string;
  patient?: Patient;
}

export interface Appointment {
  id: string;
  patient_id: string;
  doctor_id: string | null;
  appointment_date: string;
  appointment_time: string;
  duration_minutes: number;
  reason: string | null;
  status: 'scheduled' | 'arrived' | 'no_show' | 'cancelled' | 'completed' | 'postponed' | 'in_consultation';
  notes: string | null;
  checked_in_at: string | null;
  postponed_appointment_id: string | null;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  patient?: Patient;
  doctor?: Profile;
}

export interface WaitingQueueEntry {
  id: string;
  patient_id: string;
  appointment_id: string | null;
  queue_type: 'H' | 'F';
  queue_number: string;
  status: 'waiting' | 'called' | 'pending_acceptance' | 'in_consultation' | 'completed' | 'skipped' | 'returned';
  called_at: string | null;
  entered_consultation_at: string | null;
  completed_at: string | null;
  doctor_id: string | null;
  created_at: string;
  updated_at: string;
  patient?: Patient;
}

export interface CallRecord {
  id: string;
  queue_id: string;
  patient_id: string;
  queue_number: string;
  patient_name: string;
  call_text: string;
  called_by: string | null;
  status: 'called' | 'recall' | 'skipped';
  created_at: string;
}

export interface WaitingSettings {
  id: string;
  show_patient_name: boolean;
  voice_enabled: boolean;
  voice_volume: number;
  voice_rate: number;
  voice_pitch: number;
  voice_repeat_count: number;
  voice_lang: string;
  updated_at: string;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  unit_price: number;
  tva_rate: number;
  category: string | null;
  active: boolean;
  created_at: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  patient_id: string;
  medical_file_id: string | null;
  consultation_id: string | null;
  created_by: string | null;
  subtotal: number;
  discount: number;
  tva_amount: number;
  total: number;
  paid_amount: number;
  remaining_amount: number;
  status: 'unpaid' | 'partially_paid' | 'paid' | 'cancelled';
  cancellation_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  patient?: Patient;
  invoice_items?: InvoiceItem[];
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  service_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount: number;
  tva_rate: number;
  total: number;
  created_at: string;
}

export interface Payment {
  id: string;
  payment_number: string;
  invoice_id: string;
  patient_id: string;
  amount: number;
  method: 'cash' | 'card' | 'guarantee_card';
  received_by: string | null;
  notes: string | null;
  created_at: string;
}

export interface Receipt {
  id: string;
  receipt_number: string;
  payment_id: string;
  patient_id: string;
  invoice_id: string;
  amount: number;
  method: string;
  remaining_balance: number;
  issued_by: string | null;
  created_at: string;
}

export interface Debt {
  id: string;
  patient_id: string;
  invoice_id: string;
  original_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: 'active' | 'paid';
  notes: string | null;
  created_at: string;
  updated_at: string;
  patient?: Patient;
  invoice?: Invoice;
}

export interface Message {
  id: string;
  sender_id: string;
  recipient_id: string | null;
  content: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  type: string;
  is_read: boolean;
  link: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_description: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  device_type: string | null;
  created_at: string;
}

export interface RecordVersion {
  id: string;
  entity_type: 'consultation' | 'diagnosis' | 'prescription' | 'medical_note';
  entity_id: string;
  version_number: number;
  changed_by: string | null;
  changed_fields: Record<string, unknown>;
  previous_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  created_at: string;
}

export interface Device {
  id: string;
  device_type: 'SERVER' | 'RECEPTION' | 'DOCTOR' | 'WAITING_MALE' | 'WAITING_FEMALE';
  name: string;
  status: 'online' | 'offline';
  last_connection: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Settings {
  key: string;
  value: Record<string, unknown>;
  updated_at: string;
}

export interface MedicalHistoryEntry {
  id: string;
  patient_id: string;
  description: string;
  approximate_date: string | null;
  notes: string | null;
  created_at: string;
}

export interface SurgicalHistoryEntry {
  id: string;
  patient_id: string;
  intervention: string;
  operation_date: string | null;
  establishment: string | null;
  notes: string | null;
  created_at: string;
}

export interface FamilyHistoryEntry {
  id: string;
  patient_id: string;
  condition_name: string;
  notes: string | null;
  created_at: string;
}

export interface Pregnancy {
  id: string;
  patient_id: string;
  is_pregnant: boolean;
  gravidity: number | null;
  parity: number | null;
  lmp_date: string | null;
  gestational_age_weeks: number | null;
  expected_term_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
