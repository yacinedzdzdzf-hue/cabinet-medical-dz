/*
# CMDZ — Fix appointments.doctor_id foreign key to point to profiles, not auth.users

The FK was pointing to auth.users(id) instead of profiles(id).
PostgREST (Supabase) uses FKs to resolve nested select joins.
Since the query uses `doctor:profiles(*)`, the FK must point to profiles.
*/

-- Drop the wrong FK
ALTER TABLE public.appointments DROP CONSTRAINT appointments_doctor_id_fkey;

-- Add the correct FK pointing to profiles
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_doctor_id_fkey
  FOREIGN KEY (doctor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
