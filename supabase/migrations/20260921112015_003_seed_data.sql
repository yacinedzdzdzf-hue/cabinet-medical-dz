/*
# CMDZ — Seed Data

Inserts default settings, waiting settings, sample medications, sample services,
and default devices. Admin/doctor/reception user accounts are created via the
admin-promotion edge function (needs service role to set app_metadata).
*/

-- Default clinic settings
INSERT INTO public.settings (key, value) VALUES
  ('clinic', '{"name":"Cabinet Médical DZ","address":"","phone":"","email":"","nif":"","nis":"","rc":"","specialty":"Médecine générale","registration_number":"","logo_url":"","signature_url":"","stamp_url":""}'),
  ('billing', '{"currency":"DA","tva_rate":0,"default_paper_size":"A4"}'),
  ('voice', '{"enabled":true,"volume":1.0,"rate":1.0,"pitch":1.0,"repeat_count":1,"lang":"fr-FR"}'),
  ('queue', '{"show_patient_name":true}'),
  ('printer', '{"default_size":"A4","receipt_size":"80mm"}'),
  ('auto_lock', '{"enabled":false,"timeout_minutes":15}'),
  ('backup', '{"frequency":"daily","retention_days":30,"last_backup":null}')
ON CONFLICT (key) DO NOTHING;

-- Default waiting settings
INSERT INTO public.waiting_settings (show_patient_name, voice_enabled, voice_volume, voice_rate, voice_pitch, voice_repeat_count, voice_lang)
VALUES (true, true, 1.0, 1.0, 1.0, 1, 'fr-FR')
ON CONFLICT (id) DO NOTHING;

-- Default devices
INSERT INTO public.devices (device_type, name, status) VALUES
  ('SERVER', 'Serveur Principal', 'online'),
  ('RECEPTION', 'Poste Réception', 'offline'),
  ('DOCTOR', 'Poste Médecin', 'offline'),
  ('WAITING_MALE', 'Écran Salle d''Attente Hommes', 'offline'),
  ('WAITING_FEMALE', 'Écran Salle d''Attente Femmes', 'offline')
ON CONFLICT DO NOTHING;

-- Sample medications
INSERT INTO public.medications (commercial_name, dci, active_ingredient, strength, form, manufacturer, is_favorite) VALUES
  ('Doliprane', 'Paracétamol', 'Paracétamol', '500mg', 'Comprimé', 'Sanofi', true),
  ('Efferalgan', 'Paracétamol', 'Paracétamol', '1g', 'Comprimé effervescent', 'UPSA', true),
  ('Augmentin', 'Amoxicilline + Acide clavulanique', 'Amoxicilline', '1g', 'Comprimé', 'GSK', true),
  ('Amoxil', 'Amoxicilline', 'Amoxicilline', '500mg', 'Gélule', 'GSK', false),
  ('Mopral', 'Oméprazole', 'Oméprazole', '20mg', 'Gélule', 'AstraZeneca', true),
  ('Smecta', 'Diosmectite', 'Diosmectite', '3g', 'Sachet', 'Ipsen', false),
  ('Spasfon', 'Phloroglucinol', 'Phloroglucinol', '80mg', 'Comprimé', 'Teva', true),
  ('Voltarène', 'Diclofénac', 'Diclofénac', '50mg', 'Comprimé', 'Novartis', false),
  ('Crestor', 'Rosuvastatine', 'Rosuvastatine', '10mg', 'Comprimé', 'AstraZeneca', false),
  ('Xanax', 'Alprazolam', 'Alprazolam', '0.25mg', 'Comprimé', 'Pfizer', false),
  ('Bisoprolol', 'Bisoprolol', 'Bisoprolol', '5mg', 'Comprimé', 'Merck', false),
  ('Forlavix', 'Clopidogrel', 'Clopidogrel', '75mg', 'Comprimé', 'Sanofi', false)
ON CONFLICT DO NOTHING;

-- Sample services
INSERT INTO public.services (name, description, unit_price, tva_rate, category, active) VALUES
  ('Consultation générale', 'Consultation de médecine générale', 1500, 0, 'Consultation', true),
  ('Consultation spécialisée', 'Consultation avec spécialiste', 3000, 0, 'Consultation', true),
  ('Suivi', 'Suivi de traitement', 1000, 0, 'Consultation', true),
  ('Vaccination', 'Acte de vaccination', 500, 0, 'Acte', true),
  ('Pansement', 'Pansement simple', 300, 0, 'Acte', true),
  ('Électrocardiogramme', 'ECG', 800, 0, 'Examen', true),
  ('Prise de tension', 'Mesure de la tension artérielle', 200, 0, 'Acte', true),
  ('Injections', 'Injection intramusculaire', 250, 0, 'Acte', true),
  ('Certificat médical', 'Délivrance de certificat médical', 500, 0, 'Document', true),
  ('Radiographie', 'Prescription radiographie', 0, 0, 'Examen', true)
ON CONFLICT DO NOTHING;
