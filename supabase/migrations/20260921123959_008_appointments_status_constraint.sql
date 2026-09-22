/*
# CMDZ — Update appointments status constraint

Add 'postponed' and 'in_consultation' to the allowed statuses.
*/

ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;

ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check
  CHECK (status = ANY (ARRAY[
    'scheduled'::text,
    'arrived'::text,
    'no_show'::text,
    'cancelled'::text,
    'completed'::text,
    'postponed'::text,
    'in_consultation'::text
  ]));
