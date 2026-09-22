/*
# CMDZ — Recharge du cache de schéma PostgREST + médecin du rendez-vous

1. `NOTIFY pgrst, 'reload schema'` : la correction des clés étrangères (migration 023)
   doit être rechargée par l'API pour que la relation `doctor:profiles(*)` soit
   reconnue immédiatement.
2. `consultation_workflow()` expose aussi le médecin affecté au rendez-vous,
   affiché sur les cartes « À accepter » et « En consultation ».
*/

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
        'appointment_doctor_name', ad.full_name,
        'medical_file_number', (SELECT f.file_number FROM public.medical_files f WHERE f.patient_id = w.patient_id LIMIT 1)
      ) AS x
      FROM public.waiting_queue w
      LEFT JOIN public.patients p ON p.id = w.patient_id
      LEFT JOIN public.appointments a ON a.id = w.appointment_id
      LEFT JOIN public.profiles ad ON ad.id = a.doctor_id
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
        'appointment_doctor_name', ad.full_name,
        'doctor_id', w.doctor_id,
        'doctor_name', pr.full_name,
        'consultation_id', (SELECT c.id FROM public.consultations c WHERE c.queue_id = w.id LIMIT 1),
        'entered_at', w.entered_consultation_at
      ) AS x
      FROM public.waiting_queue w
      LEFT JOIN public.patients p ON p.id = w.patient_id
      LEFT JOIN public.appointments a ON a.id = w.appointment_id
      LEFT JOIN public.profiles ad ON ad.id = a.doctor_id
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

REVOKE ALL ON FUNCTION public.consultation_workflow() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultation_workflow() TO authenticated;

-- Force l'API à relire les clés étrangères corrigées
NOTIFY pgrst, 'reload schema';
