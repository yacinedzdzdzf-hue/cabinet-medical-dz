/*
# CMDZ — Medications table upgrade

Adds missing columns to the medications table for a complete pharmaceutical database:
- code (unique medication code)
- pharmaceutical_form (renamed from form)
- laboratory
- route
- default_dosage
- default_frequency
- default_duration
- instructions
- is_active (for archiving instead of deleting)
- updated_at

Also adds indexes for search and a unique constraint on code.
Preserves existing data. The old 'form' column is kept for backward compatibility
(prescription_items still reference it), but new code uses pharmaceutical_form.
*/

-- Add new columns
ALTER TABLE public.medications
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS pharmaceutical_form text,
  ADD COLUMN IF NOT EXISTS laboratory text,
  ADD COLUMN IF NOT EXISTS route text,
  ADD COLUMN IF NOT EXISTS default_dosage text,
  ADD COLUMN IF NOT EXISTS default_frequency text,
  ADD COLUMN IF NOT EXISTS default_duration text,
  ADD COLUMN IF NOT EXISTS instructions text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Copy form → pharmaceutical_form for existing rows
UPDATE public.medications
SET pharmaceutical_form = form
WHERE pharmaceutical_form IS NULL AND form IS NOT NULL;

-- Add indexes for search
CREATE INDEX IF NOT EXISTS idx_meds_code ON public.medications (code);
CREATE INDEX IF NOT EXISTS idx_meds_active_ingredient ON public.medications (active_ingredient);
CREATE INDEX IF NOT EXISTS idx_meds_active ON public.medications (is_active);

-- Add unique constraint on code (only for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_meds_code_unique
  ON public.medications (code)
  WHERE code IS NOT NULL;

-- Add unique constraint to prevent duplicate commercial_name + strength
CREATE UNIQUE INDEX IF NOT EXISTS idx_meds_name_strength_unique
  ON public.medications (lower(commercial_name), COALESCE(strength, ''))
  WHERE is_active = true;

-- Update existing RLS policies to also allow DOCTOR to insert/update (already exists, just verifying)
-- The existing policies already allow ADMIN, DOCTOR, RECEPTION for select/insert/update

-- Add a trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_medications_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_medications_update ON public.medications;
CREATE TRIGGER on_medications_update
  BEFORE UPDATE ON public.medications
  FOR EACH ROW EXECUTE FUNCTION public.update_medications_timestamp();
