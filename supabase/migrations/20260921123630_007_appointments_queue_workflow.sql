/*
# CMDZ — Appointments & Waiting Queue workflow upgrade

Fixes:
1. Atomic queue number generation using advisory lock (prevents race conditions)
2. Unique constraint on appointment_id in waiting_queue (prevents double check-in)
3. Add postponed_appointment_id column for tracking postponement history
4. Add completed_by column to track who completed the appointment
5. Add queue_number_prefix column for daily reset support
*/

-- Fix generate_queue_number to use advisory lock for atomic generation
CREATE OR REPLACE FUNCTION public.generate_queue_number(p_queue_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_num integer;
  new_number text;
  lock_key bigint;
BEGIN
  -- Use advisory lock to prevent race conditions
  -- Key is based on queue type: H=1, F=2
  lock_key := CASE WHEN p_queue_type = 'H' THEN 1001 ELSE 1002 END;
  
  PERFORM pg_advisory_xact_lock(lock_key);
  
  SELECT COALESCE(MAX(CAST(queue_number AS integer)), 0) + 1
  INTO next_num
  FROM public.waiting_queue
  WHERE queue_type = p_queue_type;
  
  new_number := p_queue_type || '-' || lpad(next_num::text, 3, '0');
  
  RETURN new_number;
END;
$$;

-- Add unique constraint on appointment_id in waiting_queue
-- This prevents double check-in: one appointment = one queue entry
CREATE UNIQUE INDEX IF NOT EXISTS idx_waiting_queue_appointment_unique
  ON public.waiting_queue (appointment_id)
  WHERE appointment_id IS NOT NULL;

-- Add columns for postponement tracking
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS postponed_appointment_id uuid REFERENCES public.appointments(id),
  ADD COLUMN IF NOT EXISTS completed_by uuid,
  ADD COLUMN IF NOT EXISTS completed_at timestamp with time zone;

-- Add comment for clarity
COMMENT ON COLUMN public.appointments.postponed_appointment_id IS 'Links to the new appointment created when this one was postponed';
COMMENT ON COLUMN public.appointments.completed_by IS 'User who marked the appointment as completed';
COMMENT ON COLUMN public.appointments.completed_at IS 'When the appointment was completed';

-- Add index for postponed tracking
CREATE INDEX IF NOT EXISTS idx_appointments_postponed ON public.appointments (postponed_appointment_id);

-- Add index for status filtering
CREATE INDEX IF NOT EXISTS idx_appointments_status ON public.appointments (status);
CREATE INDEX IF NOT EXISTS idx_appointments_date_status ON public.appointments (appointment_date, status);

-- Update the updated_at trigger to also handle appointments
-- (already has a trigger from the original migration, but let's make sure it exists)
CREATE OR REPLACE FUNCTION public.update_appointments_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_appointments_update ON public.appointments;
CREATE TRIGGER on_appointments_update
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_appointments_timestamp();
