/*
# CMDZ — Tighten medications RLS policies

RECEPTION should NOT have access to medication data (sensitive medical data).
Only ADMIN and DOCTOR can manage medications.
*/

ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;

-- Drop old policies that allowed RECEPTION
DROP POLICY IF EXISTS "meds_select_staff" ON public.medications;
DROP POLICY IF EXISTS "meds_insert_staff" ON public.medications;
DROP POLICY IF EXISTS "meds_update_staff" ON public.medications;
DROP POLICY IF EXISTS "meds_delete_staff" ON public.medications;

-- New policies: only ADMIN and DOCTOR
CREATE POLICY "meds_select_doctor" ON public.medications FOR SELECT
  TO authenticated USING (public.is_admin() OR public.is_doctor());

CREATE POLICY "meds_insert_doctor" ON public.medications FOR INSERT
  TO authenticated WITH CHECK (public.is_admin() OR public.is_doctor());

CREATE POLICY "meds_update_doctor" ON public.medications FOR UPDATE
  TO authenticated USING (public.is_admin() OR public.is_doctor())
  WITH CHECK (public.is_admin() OR public.is_doctor());

CREATE POLICY "meds_delete_admin" ON public.medications FOR DELETE
  TO authenticated USING (public.is_admin());
