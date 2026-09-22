/*
# CMDZ — Index d'agenda pour la page Rendez-vous

- appointment_time : absente des index existants, nécessaire pour le tri de
  l'agenda du jour et des vues semaine/mois.
- (appointment_date, appointment_time) : tri combiné utilisé par la requête.
- patient_id + date : jointure patient / prochains rendez-vous d'un dossier.
- Lower(last_name/first_name/phone) : accélère la recherche patient (page Rendez-vous,
  dossier médical, liste patients) qui utilise des ILIKE sur ces colonnes.
*/

CREATE INDEX IF NOT EXISTS idx_appointments_date_time
  ON public.appointments (appointment_date, appointment_time);

CREATE INDEX IF NOT EXISTS idx_appointments_patient_date_time
  ON public.appointments (patient_id, appointment_date, appointment_time);

CREATE INDEX IF NOT EXISTS idx_patients_last_name_lower
  ON public.patients (lower(last_name));

CREATE INDEX IF NOT EXISTS idx_patients_first_name_lower
  ON public.patients (lower(first_name));

CREATE INDEX IF NOT EXISTS idx_patients_phone
  ON public.patients (phone);

CREATE INDEX IF NOT EXISTS idx_patients_patient_number
  ON public.patients (patient_number);
