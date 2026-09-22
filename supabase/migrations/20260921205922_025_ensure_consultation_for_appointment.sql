/*
# CMDZ — ensure_consultation_for_appointment

Ouvre la consultation liée à un couple (patient, rendez-vous) :
- si elle existe déjà, elle est renvoyée telle quelle (aucun doublon) ;
- sinon elle est créée avec le médecin demandé.
Aucun contrôle d'état du rendez-vous : l'action « Ouvrir » part d'une situation
déjà acceptée. L'entrée de file d'attente liée est réutilisée si elle existe.

Journalise CONSULTATION_OPENED au moment de l'ouverture réelle.
*/

CREATE OR REPLACE FUNCTION public.ensure_consultation_for_appointment(
  p_patient_id uuid,
  p_appointment_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed boolean;
  v_consultation_id uuid;
  v_medical_file_id uuid;
  v_queue_id uuid;
  v_doctor_id uuid;
  v_name text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('ADMIN','DOCTOR','RECEPTION') AND active = true
  ) INTO v_allowed;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Accès refusé : votre rôle ne permet pas d''ouvrir une consultation.'
      USING ERRCODE = '42501';
  END IF;

  IF p_patient_id IS NULL THEN
    RAISE EXCEPTION 'Patient manquant.' USING ERRCODE = 'P0002';
  END IF;

  -- Le rendez-vous, s'il est fourni, doit appartenir au patient
  IF p_appointment_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.appointments WHERE id = p_appointment_id AND patient_id = p_patient_id) THEN
      RAISE EXCEPTION 'Le rendez-vous ne correspond pas au patient.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_doctor_id := auth.uid();

  SELECT id INTO v_queue_id
  FROM public.waiting_queue
  WHERE patient_id = p_patient_id
    AND (p_appointment_id IS NULL OR appointment_id = p_appointment_id)
    AND status IN ('pending_acceptance','in_consultation')
  ORDER BY created_at DESC LIMIT 1;

  SELECT id INTO v_consultation_id
  FROM public.consultations
  WHERE patient_id = p_patient_id
    AND ((p_appointment_id IS NOT NULL AND appointment_id = p_appointment_id)
         OR (v_queue_id IS NOT NULL AND queue_id = v_queue_id))
  LIMIT 1;

  IF v_consultation_id IS NULL THEN
    SELECT id INTO v_medical_file_id FROM public.medical_files WHERE patient_id = p_patient_id LIMIT 1;
    INSERT INTO public.consultations (patient_id, medical_file_id, doctor_id, queue_id, appointment_id, status, started_at)
    VALUES (p_patient_id, v_medical_file_id, v_doctor_id, v_queue_id, p_appointment_id, 'in_progress', now())
    RETURNING id INTO v_consultation_id;
  END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, entity_description, details)
  VALUES (
    auth.uid(), v_name, 'CONSULTATION_OPENED', 'consultation', v_consultation_id,
    p_appointment_id::text,
    jsonb_build_object(
      'patient_id', p_patient_id, 'appointment_id', p_appointment_id,
      'doctor_id', v_doctor_id, 'user_id', auth.uid(),
      'consultation_id', v_consultation_id,
      'date', to_char(now(), 'DD/MM/YYYY'), 'heure', to_char(now(), 'HH24:MI'), 'at', now()
    )
  );

  RETURN jsonb_build_object(
    'consultation_id', v_consultation_id, 'patient_id', p_patient_id,
    'appointment_id', p_appointment_id, 'queue_id', v_queue_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_consultation_for_appointment(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_consultation_for_appointment(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
