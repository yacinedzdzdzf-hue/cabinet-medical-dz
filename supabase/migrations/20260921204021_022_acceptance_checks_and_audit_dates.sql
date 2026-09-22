/*
# CMDZ — Contrôles renforcés à l'acceptation + audit daté

- Vérifie que le rendez-vous lié appartient bien au patient de la file
  (un identifiant incohérent est refusé, jamais accepté silencieusement).
- Vérifie que la consultation réutilisée appartient bien au même patient.
- Enrichit l'audit avec des champs date / heure explicites.
*/

CREATE OR REPLACE FUNCTION public.accept_consultation(p_queue_id uuid)
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
  v_doctor_name text;
  v_appt_patient uuid;
  v_consult_patient uuid;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('ADMIN','DOCTOR','RECEPTION') AND active = true
  ) INTO v_allowed;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Accès refusé : votre rôle ne permet pas d''accepter une consultation.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_entry FROM public.waiting_queue WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entrée de file d''attente introuvable.' USING ERRCODE = 'P0002';
  END IF;

  -- Le rendez-vous lié doit appartenir au patient de la file
  IF v_entry.appointment_id IS NOT NULL THEN
    SELECT patient_id INTO v_appt_patient FROM public.appointments WHERE id = v_entry.appointment_id;
    IF v_appt_patient IS DISTINCT FROM v_entry.patient_id THEN
      RAISE EXCEPTION 'Le rendez-vous ne correspond pas au patient de la file d''attente.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_entry.status = 'in_consultation' THEN
    SELECT id, patient_id INTO v_consultation_id, v_consult_patient
    FROM public.consultations WHERE queue_id = p_queue_id LIMIT 1;
    IF v_consult_patient IS DISTINCT FROM v_entry.patient_id AND v_consultation_id IS NOT NULL THEN
      RAISE EXCEPTION 'Consultation incohérente pour ce patient.' USING ERRCODE = 'P0001';
    END IF;
    IF v_entry.doctor_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Ce patient a déjà été pris en charge par un autre médecin.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'consultation_id', v_consultation_id, 'patient_id', v_entry.patient_id,
      'appointment_id', v_entry.appointment_id, 'queue_id', v_entry.id,
      'doctor_id', v_entry.doctor_id, 'already_accepted', true
    );
  END IF;

  IF v_entry.status <> 'pending_acceptance' THEN
    RAISE EXCEPTION 'Ce patient n''est pas en attente d''acceptation (statut : %).', v_entry.status
      USING ERRCODE = 'P0001';
  END IF;

  v_doctor_id := CASE WHEN public.is_doctor() THEN auth.uid() ELSE coalesce(v_entry.doctor_id, auth.uid()) END;

  SELECT id INTO v_medical_file_id FROM public.medical_files WHERE patient_id = v_entry.patient_id LIMIT 1;

  SELECT id, patient_id INTO v_consultation_id, v_consult_patient
  FROM public.consultations WHERE queue_id = p_queue_id LIMIT 1;

  IF v_consultation_id IS NULL AND v_entry.appointment_id IS NOT NULL THEN
    SELECT id, patient_id INTO v_consultation_id, v_consult_patient
    FROM public.consultations
    WHERE patient_id = v_entry.patient_id AND appointment_id = v_entry.appointment_id LIMIT 1;
  END IF;

  IF v_consultation_id IS NOT NULL AND v_consult_patient IS DISTINCT FROM v_entry.patient_id THEN
    RAISE EXCEPTION 'Consultation incohérente pour ce patient.' USING ERRCODE = 'P0001';
  END IF;

  IF v_consultation_id IS NULL THEN
    INSERT INTO public.consultations (patient_id, medical_file_id, doctor_id, queue_id, appointment_id, status, started_at)
    VALUES (v_entry.patient_id, v_medical_file_id, v_doctor_id, p_queue_id, v_entry.appointment_id, 'in_progress', now())
    RETURNING id INTO v_consultation_id;
  ELSE
    UPDATE public.consultations
    SET status = 'in_progress', updated_at = now(),
        doctor_id = coalesce(doctor_id, v_doctor_id),
        queue_id = coalesce(queue_id, p_queue_id),
        appointment_id = coalesce(appointment_id, v_entry.appointment_id)
    WHERE id = v_consultation_id;
  END IF;

  UPDATE public.waiting_queue
  SET status = 'in_consultation',
      entered_consultation_at = coalesce(entered_consultation_at, now()),
      doctor_id = v_doctor_id,
      updated_at = now()
  WHERE id = p_queue_id;

  IF v_entry.appointment_id IS NOT NULL THEN
    UPDATE public.appointments
    SET status = 'in_consultation', updated_at = now()
    WHERE id = v_entry.appointment_id AND status NOT IN ('completed', 'cancelled');
  END IF;

  SELECT full_name INTO v_doctor_name FROM public.profiles WHERE id = v_doctor_id;

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, entity_description, details)
  VALUES (
    auth.uid(), v_doctor_name, 'CONSULTATION_ACCEPTED', 'appointment', v_entry.appointment_id,
    v_entry.queue_number,
    jsonb_build_object(
      'patient_id', v_entry.patient_id, 'appointment_id', v_entry.appointment_id,
      'doctor_id', v_doctor_id, 'doctor', v_doctor_name, 'user_id', auth.uid(),
      'consultation_id', v_consultation_id, 'queue_id', v_entry.id,
      'date', to_char(now(), 'DD/MM/YYYY'), 'heure', to_char(now(), 'HH24:MI'), 'at', now()
    )
  );

  RETURN jsonb_build_object(
    'consultation_id', v_consultation_id, 'patient_id', v_entry.patient_id,
    'appointment_id', v_entry.appointment_id, 'queue_id', v_entry.id,
    'doctor_id', v_doctor_id, 'already_accepted', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.send_patient_to_consultation(p_queue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.waiting_queue%ROWTYPE;
  v_allowed boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('ADMIN','DOCTOR','RECEPTION') AND active = true
  ) INTO v_allowed;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Accès refusé : votre rôle ne permet pas d''envoyer un patient en consultation.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_entry FROM public.waiting_queue WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entrée de file d''attente introuvable.' USING ERRCODE = 'P0002';
  END IF;

  IF v_entry.status = 'pending_acceptance' THEN
    RETURN jsonb_build_object(
      'queue_id', v_entry.id, 'patient_id', v_entry.patient_id,
      'appointment_id', v_entry.appointment_id, 'status', v_entry.status, 'already_sent', true
    );
  END IF;

  IF v_entry.status NOT IN ('waiting','called','returned') THEN
    RAISE EXCEPTION 'Ce patient ne peut plus être envoyé en consultation (statut : %).', v_entry.status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.waiting_queue SET status = 'pending_acceptance', updated_at = now() WHERE id = p_queue_id;

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, entity_description, details)
  SELECT auth.uid(), pr.full_name, 'PATIENT_SENT_TO_CONSULTATION', 'appointment', v_entry.appointment_id,
         v_entry.queue_number,
         jsonb_build_object(
           'patient_id', v_entry.patient_id, 'appointment_id', v_entry.appointment_id,
           'queue_id', v_entry.id, 'queue_number', v_entry.queue_number,
           'user_id', auth.uid(), 'user', pr.full_name,
           'date', to_char(now(), 'DD/MM/YYYY'), 'heure', to_char(now(), 'HH24:MI'), 'at', now()
         )
  FROM public.profiles pr WHERE pr.id = auth.uid();

  RETURN jsonb_build_object(
    'queue_id', v_entry.id, 'patient_id', v_entry.patient_id,
    'appointment_id', v_entry.appointment_id, 'status', 'pending_acceptance', 'already_sent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.send_patient_to_consultation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_consultation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_patient_to_consultation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_consultation(uuid) TO authenticated;
