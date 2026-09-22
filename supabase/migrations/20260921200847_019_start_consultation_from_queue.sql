/*
# CMDZ — Transfert atomique « Salle d'attente → Consultation »

Le bouton « Consulter » ne doit jamais laisser un état incohérent
(patient retiré de la file mais statut encore `waiting`).

`start_consultation_from_queue(p_queue_id)` exécute en une seule transaction :
  1. vérifie que l'appelant est un membre autorisé de l'équipe (jamais un ID
     fourni par l'interface : seule l'entrée de file sert de référence) ;
  2. verrouille l'entrée de file et refuse une entrée déjà clôturée ;
  3. crée (ou réouvre) la consultation liée à cette entrée ;
  4. passe la file d'attente à `in_consultation` ;
  5. passe le rendez-vous lié à `in_consultation` ;
  6. journalise `APPOINTMENT_IN_CONSULTATION` avec patient, rendez-vous,
     utilisateur et horodatage.

En cas d'erreur la transaction est annulée : rien n'est modifié.
L'appel est idempotent (double clic) : une entrée déjà en consultation
renvoie la même consultation sans créer de doublon.
*/

CREATE OR REPLACE FUNCTION public.start_consultation_from_queue(p_queue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.waiting_queue%ROWTYPE;
  v_allowed boolean;
  v_doctor_id uuid;
  v_consultation_id uuid;
  v_medical_file_id uuid;
  v_patient_name text;
BEGIN
  -- 1. Autorisation (équipe soignante uniquement)
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('ADMIN','DOCTOR','RECEPTION') AND active = true
  ) INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Accès refusé : votre rôle ne permet pas d''ouvrir une consultation.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. L'entrée de file est la seule source de vérité (patient + rendez-vous)
  SELECT * INTO v_entry FROM public.waiting_queue WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entrée de file d''attente introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF v_entry.status IN ('completed', 'skipped') THEN
    RAISE EXCEPTION 'Ce patient a déjà quitté la file d''attente.' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Médecin traitant : l'utilisateur s'il est médecin, sinon celui déjà désigné
  v_doctor_id := CASE
    WHEN public.is_doctor() THEN auth.uid()
    ELSE coalesce(v_entry.doctor_id, auth.uid())
  END;

  SELECT id INTO v_medical_file_id
  FROM public.medical_files WHERE patient_id = v_entry.patient_id LIMIT 1;

  SELECT id INTO v_consultation_id
  FROM public.consultations WHERE queue_id = p_queue_id LIMIT 1;

  IF v_consultation_id IS NULL THEN
    INSERT INTO public.consultations (patient_id, medical_file_id, doctor_id, queue_id, status)
    VALUES (v_entry.patient_id, v_medical_file_id, v_doctor_id, p_queue_id, 'in_progress')
    RETURNING id INTO v_consultation_id;
  ELSE
    UPDATE public.consultations
    SET status = 'in_progress', updated_at = now(), doctor_id = coalesce(doctor_id, v_doctor_id)
    WHERE id = v_consultation_id;
  END IF;

  -- 4. Sortie de la file d'attente
  UPDATE public.waiting_queue
  SET status = 'in_consultation',
      entered_consultation_at = coalesce(entered_consultation_at, now()),
      doctor_id = v_doctor_id,
      updated_at = now()
  WHERE id = p_queue_id;

  -- 5. Statut du rendez-vous lié
  IF v_entry.appointment_id IS NOT NULL THEN
    UPDATE public.appointments
    SET status = 'in_consultation', updated_at = now()
    WHERE id = v_entry.appointment_id
      AND status NOT IN ('in_consultation', 'completed', 'cancelled');
  END IF;

  -- 6. Journal d'activité
  SELECT full_name INTO v_patient_name FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, entity_description, details)
  VALUES (
    auth.uid(), v_patient_name, 'APPOINTMENT_IN_CONSULTATION', 'appointment', v_entry.appointment_id,
    v_entry.queue_number,
    jsonb_build_object(
      'patient_id', v_entry.patient_id,
      'appointment_id', v_entry.appointment_id,
      'queue_id', v_entry.id,
      'consultation_id', v_consultation_id,
      'queue_number', v_entry.queue_number,
      'user', v_patient_name,
      'at', now()
    )
  );

  RETURN jsonb_build_object(
    'consultation_id', v_consultation_id,
    'patient_id', v_entry.patient_id,
    'appointment_id', v_entry.appointment_id,
    'queue_id', v_entry.id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_consultation_from_queue(uuid) TO authenticated;
