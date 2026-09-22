/*
# CMDZ — Séparation « Consulter » (envoi) et « Accepter » (prise en charge)

Nouveau flux à statut unique, sans second système parallèle :
  waiting → called → pending_acceptance → in_consultation → completed

- `Consulter` (salle d'attente) = send_patient_to_consultation : marque le patient
  comme envoyé et en attente d'acceptation. AUCUNE consultation n'est créée.
- `Accepter` (page Consultations) = accept_consultation : le médecin prend le
  patient, la consultation est créée/réutilisée et le rendez-vous passe en
  consultation. Verrouillage `FOR UPDATE` : un seul médecin peut accepter.
- `return_to_waiting_queue` : renvoie le patient dans la file sans nouveau rendez-vous.

Ajoute aussi consultations.appointment_id pour garantir qu'une consultation
correspond au bon rendez-vous (et éviter tout doublon patient + rendez-vous).
*/

-- 1. Statut d'attente d'acceptation
ALTER TABLE public.waiting_queue DROP CONSTRAINT IF EXISTS waiting_queue_status_check;
ALTER TABLE public.waiting_queue ADD CONSTRAINT waiting_queue_status_check
  CHECK (status IN ('waiting','called','pending_acceptance','in_consultation','completed','skipped','returned'));

-- 2. Lien consultation ↔ rendez-vous (nécessaire pour le suivi par rendez-vous)
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL;

UPDATE public.consultations c
SET appointment_id = w.appointment_id
FROM public.waiting_queue w
WHERE c.queue_id = w.id AND c.appointment_id IS NULL AND w.appointment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_consultations_appointment ON public.consultations (appointment_id);
CREATE INDEX IF NOT EXISTS idx_consultations_queue ON public.consultations (queue_id);
CREATE INDEX IF NOT EXISTS idx_waiting_queue_status ON public.waiting_queue (status);

-- 3. Consulter : envoie le patient dans le flux de consultation (sans créer de consultation)
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

  -- Déjà envoyé : on renvoie le même état (double clic sans conséquence)
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

  UPDATE public.waiting_queue
  SET status = 'pending_acceptance', updated_at = now()
  WHERE id = p_queue_id;

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, entity_description, details)
  SELECT auth.uid(), pr.full_name, 'PATIENT_SENT_TO_CONSULTATION', 'appointment', v_entry.appointment_id,
         v_entry.queue_number,
         jsonb_build_object(
           'patient_id', v_entry.patient_id, 'appointment_id', v_entry.appointment_id,
           'queue_id', v_entry.id, 'queue_number', v_entry.queue_number,
           'user_id', auth.uid(), 'user', pr.full_name, 'at', now()
         )
  FROM public.profiles pr WHERE pr.id = auth.uid();

  RETURN jsonb_build_object(
    'queue_id', v_entry.id, 'patient_id', v_entry.patient_id,
    'appointment_id', v_entry.appointment_id, 'status', 'pending_acceptance', 'already_sent', false
  );
END;
$$;

-- 4. Accepter : le médecin prend réellement le patient (concurrence maîtrisée)
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
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('ADMIN','DOCTOR','RECEPTION') AND active = true
  ) INTO v_allowed;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Accès refusé : votre rôle ne permet pas d''accepter une consultation.'
      USING ERRCODE = '42501';
  END IF;

  -- Verrou : garantit qu'un seul médecin peut accepter ce patient
  SELECT * INTO v_entry FROM public.waiting_queue WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entrée de file d''attente introuvable.' USING ERRCODE = 'P0002';
  END IF;

  IF v_entry.status = 'in_consultation' THEN
    SELECT id INTO v_consultation_id FROM public.consultations WHERE queue_id = p_queue_id LIMIT 1;
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

  -- Aucun doublon : on réutilise la consultation liée à cette entrée,
  -- sinon celle déjà liée à ce patient pour ce même rendez-vous.
  SELECT id INTO v_consultation_id FROM public.consultations WHERE queue_id = p_queue_id LIMIT 1;

  IF v_consultation_id IS NULL AND v_entry.appointment_id IS NOT NULL THEN
    SELECT id INTO v_consultation_id FROM public.consultations
    WHERE patient_id = v_entry.patient_id AND appointment_id = v_entry.appointment_id LIMIT 1;
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
    WHERE id = v_entry.appointment_id
      AND status NOT IN ('completed', 'cancelled');
  END IF;

  SELECT full_name INTO v_doctor_name FROM public.profiles WHERE id = v_doctor_id;

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, entity_description, details)
  VALUES (
    auth.uid(), v_doctor_name, 'CONSULTATION_ACCEPTED', 'appointment', v_entry.appointment_id,
    v_entry.queue_number,
    jsonb_build_object(
      'patient_id', v_entry.patient_id, 'appointment_id', v_entry.appointment_id,
      'doctor_id', v_doctor_id, 'doctor', v_doctor_name, 'user_id', auth.uid(),
      'consultation_id', v_consultation_id, 'queue_id', v_entry.id, 'at', now()
    )
  );

  RETURN jsonb_build_object(
    'consultation_id', v_consultation_id, 'patient_id', v_entry.patient_id,
    'appointment_id', v_entry.appointment_id, 'queue_id', v_entry.id,
    'doctor_id', v_doctor_id, 'already_accepted', false
  );
END;
$$;

-- 5. Retour en salle d'attente (aucun nouveau rendez-vous créé)
CREATE OR REPLACE FUNCTION public.return_to_waiting_queue(p_queue_id uuid)
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
    RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_entry FROM public.waiting_queue WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entrée de file d''attente introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF v_entry.status NOT IN ('pending_acceptance','in_consultation') THEN
    RAISE EXCEPTION 'Ce patient n''est pas dans le flux de consultation.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.waiting_queue
  SET status = 'waiting', entered_consultation_at = NULL, doctor_id = NULL, updated_at = now()
  WHERE id = p_queue_id;

  IF v_entry.appointment_id IS NOT NULL THEN
    UPDATE public.appointments
    SET status = 'arrived', updated_at = now()
    WHERE id = v_entry.appointment_id AND status = 'in_consultation';
  END IF;

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, entity_description, details)
  SELECT auth.uid(), pr.full_name, 'PATIENT_RETURNED_TO_QUEUE', 'appointment', v_entry.appointment_id,
         v_entry.queue_number,
         jsonb_build_object(
           'patient_id', v_entry.patient_id, 'appointment_id', v_entry.appointment_id,
           'queue_id', v_entry.id, 'user_id', auth.uid(), 'at', now()
         )
  FROM public.profiles pr WHERE pr.id = auth.uid();

  RETURN jsonb_build_object(
    'queue_id', v_entry.id, 'patient_id', v_entry.patient_id,
    'appointment_id', v_entry.appointment_id, 'status', 'waiting'
  );
END;
$$;

-- 6. Vue agrégée du flux + compteurs réels
CREATE OR REPLACE FUNCTION public.consultation_workflow()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
SELECT jsonb_build_object(
  'pending', coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'sent_at')
    FROM (
      SELECT jsonb_build_object(
        'queue_id', w.id,
        'queue_number', w.queue_number,
        'sent_at', w.updated_at,
        'patient', to_jsonb(p),
        'appointment', to_jsonb(a),
        'medical_file_number', (SELECT f.file_number FROM public.medical_files f WHERE f.patient_id = w.patient_id LIMIT 1)
      ) AS x
      FROM public.waiting_queue w
      LEFT JOIN public.patients p ON p.id = w.patient_id
      LEFT JOIN public.appointments a ON a.id = w.appointment_id
      WHERE w.status = 'pending_acceptance'
    ) s), '[]'::jsonb),
  'active', coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'entered_at' DESC NULLS LAST)
    FROM (
      SELECT jsonb_build_object(
        'queue_id', w.id,
        'queue_number', w.queue_number,
        'patient', to_jsonb(p),
        'appointment', to_jsonb(a),
        'doctor_id', w.doctor_id,
        'doctor_name', pr.full_name,
        'consultation_id', (SELECT c.id FROM public.consultations c WHERE c.queue_id = w.id LIMIT 1),
        'entered_at', w.entered_consultation_at
      ) AS x
      FROM public.waiting_queue w
      LEFT JOIN public.patients p ON p.id = w.patient_id
      LEFT JOIN public.appointments a ON a.id = w.appointment_id
      LEFT JOIN public.profiles pr ON pr.id = w.doctor_id
      WHERE w.status = 'in_consultation'
    ) s), '[]'::jsonb),
  'counts', jsonb_build_object(
    'pending', (SELECT count(*) FROM public.waiting_queue WHERE status = 'pending_acceptance'),
    'in_consultation', (SELECT count(*) FROM public.waiting_queue WHERE status = 'in_consultation'),
    'completed', (SELECT count(*) FROM public.consultations WHERE status = 'completed'),
    'cancelled', (SELECT count(*) FROM public.consultations WHERE status = 'cancelled')
  )
)
$$;

-- 7. Ancien point d'entrée supprimé (remplacé par send + accept)
DROP FUNCTION IF EXISTS public.start_consultation_from_queue(uuid);

REVOKE ALL ON FUNCTION public.send_patient_to_consultation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_consultation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.return_to_waiting_queue(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consultation_workflow() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_patient_to_consultation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_consultation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_to_waiting_queue(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultation_workflow() TO authenticated;
