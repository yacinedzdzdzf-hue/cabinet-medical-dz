/*
# CMDZ — Place l'extension unaccent hors du schéma public et fige les search_path

Bonnes pratiques Supabase : les extensions vivent dans le schéma `extensions`.
Les fonctions sont recréées avec le même OID (CREATE OR REPLACE), l'index
trigram reste donc valide.
*/

CREATE SCHEMA IF NOT EXISTS extensions;

ALTER EXTENSION unaccent SET SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.immutable_unaccent(txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = pg_catalog, public, extensions
AS $$ SELECT extensions.unaccent('extensions.unaccent', txt) $$;

CREATE OR REPLACE FUNCTION public.patient_search_blob(
  p_first_name text, p_last_name text, p_patient_number text,
  p_phone text, p_cin text, p_wilaya text, p_commune text, p_email text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT public.immutable_unaccent(lower(
    coalesce(p_first_name, '') || ' ' || coalesce(p_last_name, '') || ' ' ||
    coalesce(p_patient_number, '') || ' ' || coalesce(p_phone, '') || ' ' ||
    coalesce(p_cin, '') || ' ' || coalesce(p_wilaya, '') || ' ' ||
    coalesce(p_commune, '') || ' ' || coalesce(p_email, '')
  ))
$$;

GRANT USAGE ON SCHEMA extensions TO authenticated;
