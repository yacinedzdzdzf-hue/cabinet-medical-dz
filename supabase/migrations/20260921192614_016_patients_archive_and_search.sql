/*
# CMDZ — Archivage des patients : traçabilité, recherche et filtres serveur

Ajouts:
- patients.archived_at / archived_by / archived_by_name : permettent d'afficher la
  date et l'auteur réels de l'archivage sans dépendre de la RLS d'audit_logs.
- public.immutable_unaccent : enveloppe IMMUTABLE nécessaire pour indexer
  une recherche insensible aux accents.
- public.patient_search_blob : expression concaténée normalisée, indexée par trigram.
- public.search_patients : recherche + filtres combinables + tri + pagination,
  exécutés entièrement côté base.
- public.patient_filter_options : compteurs et listes d'années réels (données réelles).
*/

-- 1. Traçabilité de l'archivage
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_by_name text;

-- Backfill des patients déjà archivés (données réelles, aucune valeur inventée)
UPDATE public.patients p
SET archived_at = COALESCE(
      (SELECT a.created_at FROM public.audit_logs a
        WHERE a.entity_id = p.id AND a.action = 'PATIENT_ARCHIVED'
        ORDER BY a.created_at DESC LIMIT 1),
      p.updated_at
    ),
    archived_by_name = COALESCE(
      (SELECT a.user_name FROM public.audit_logs a
        WHERE a.entity_id = p.id AND a.action = 'PATIENT_ARCHIVED'
        ORDER BY a.created_at DESC LIMIT 1),
      p.archived_by_name
    )
WHERE p.status = 'archived'
  AND p.archived_at IS NULL;

-- 2. Recherche insensible aux accents
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.immutable_unaccent(txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$ SELECT public.unaccent('public.unaccent', txt) $$;

CREATE OR REPLACE FUNCTION public.patient_search_blob(
  p_first_name text, p_last_name text, p_patient_number text,
  p_phone text, p_cin text, p_wilaya text, p_commune text, p_email text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT public.immutable_unaccent(lower(
    coalesce(p_first_name, '') || ' ' || coalesce(p_last_name, '') || ' ' ||
    coalesce(p_patient_number, '') || ' ' || coalesce(p_phone, '') || ' ' ||
    coalesce(p_cin, '') || ' ' || coalesce(p_wilaya, '') || ' ' ||
    coalesce(p_commune, '') || ' ' || coalesce(p_email, '')
  ))
$$;

-- 3. Index
CREATE INDEX IF NOT EXISTS idx_patients_archived_at ON public.patients (archived_at);
CREATE INDEX IF NOT EXISTS idx_patients_birth_year ON public.patients (date_of_birth);
CREATE INDEX IF NOT EXISTS idx_patients_status ON public.patients (status);
CREATE INDEX IF NOT EXISTS idx_patients_sex ON public.patients (sex);

CREATE INDEX IF NOT EXISTS idx_patients_search_trgm ON public.patients
  USING gin (public.patient_search_blob(first_name, last_name, patient_number, phone, cin, wilaya, commune, email) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_medical_files_number_trgm ON public.medical_files
  USING gin (file_number gin_trgm_ops);

-- 4. Recherche serveur : filtres combinables, tri, pagination
CREATE OR REPLACE FUNCTION public.search_patients(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_sex text DEFAULT NULL,
  p_archive_year int DEFAULT NULL,
  p_birth_year int DEFAULT NULL,
  p_archived_from timestamptz DEFAULT NULL,
  p_archived_to timestamptz DEFAULT NULL,
  p_sort text DEFAULT 'archived_desc',
  p_limit int DEFAULT 15,
  p_offset int DEFAULT 0
)
RETURNS TABLE (patient jsonb, medical_file_number text, total_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH q AS (
  SELECT public.immutable_unaccent(lower(nullif(btrim(p_search), ''))) AS term
),
filtered AS (
  SELECT
    p.*,
    (SELECT f.file_number FROM public.medical_files f
      WHERE f.patient_id = p.id ORDER BY f.created_at LIMIT 1) AS mf_number
  FROM public.patients p, q
  WHERE
    (p_status IS NULL OR p.status = p_status)
    AND (p_sex IS NULL OR p.sex = p_sex)
    AND (p_archive_year IS NULL OR (
          p.archived_at IS NOT NULL
          AND p.archived_at >= make_date(p_archive_year, 1, 1)
          AND p.archived_at < make_date(p_archive_year + 1, 1, 1)))
    AND (p_birth_year IS NULL OR (
          p.date_of_birth IS NOT NULL
          AND EXTRACT(YEAR FROM p.date_of_birth)::int = p_birth_year))
    AND (p_archived_from IS NULL OR (p.archived_at IS NOT NULL AND p.archived_at >= p_archived_from))
    AND (p_archived_to IS NULL OR (p.archived_at IS NOT NULL AND p.archived_at < p_archived_to))
    AND (
      q.term IS NULL
      OR public.patient_search_blob(p.first_name, p.last_name, p.patient_number, p.phone, p.cin, p.wilaya, p.commune, p.email)
           LIKE '%' || q.term || '%'
      OR EXISTS (
        SELECT 1 FROM public.medical_files f
        WHERE f.patient_id = p.id AND public.immutable_unaccent(lower(f.file_number)) LIKE '%' || q.term || '%'
      )
    )
)
SELECT
  to_jsonb(f) AS patient,
  f.mf_number AS medical_file_number,
  count(*) OVER () AS total_count
FROM filtered f
ORDER BY
  CASE WHEN p_sort = 'archived_desc' THEN f.archived_at END DESC NULLS LAST,
  CASE WHEN p_sort = 'archived_asc'  THEN f.archived_at END ASC  NULLS LAST,
  CASE WHEN p_sort = 'name_asc'      THEN lower(f.last_name) END ASC,
  CASE WHEN p_sort = 'name_desc'     THEN lower(f.last_name) END DESC,
  CASE WHEN p_sort = 'number_asc'    THEN f.patient_number END ASC,
  CASE WHEN p_sort = 'number_desc'   THEN f.patient_number END DESC,
  CASE WHEN p_sort = 'dob_asc'       THEN f.date_of_birth END ASC NULLS LAST,
  CASE WHEN p_sort = 'dob_desc'      THEN f.date_of_birth END DESC NULLS LAST,
  f.created_at DESC
LIMIT LEAST(GREATEST(coalesce(p_limit, 15), 1), 200)
OFFSET GREATEST(coalesce(p_offset, 0), 0)
$$;

-- 5. Options de filtres et compteurs (données réelles uniquement)
CREATE OR REPLACE FUNCTION public.patient_filter_options()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
SELECT jsonb_build_object(
  'active_count',   (SELECT count(*) FROM public.patients WHERE status = 'active'),
  'archived_count', (SELECT count(*) FROM public.patients WHERE status = 'archived'),
  'total_count',    (SELECT count(*) FROM public.patients),
  'archive_years',  coalesce((
      SELECT jsonb_agg(y ORDER BY y DESC) FROM (
        SELECT DISTINCT EXTRACT(YEAR FROM archived_at)::int AS y
        FROM public.patients WHERE archived_at IS NOT NULL
      ) s), '[]'::jsonb),
  'birth_years',    coalesce((
      SELECT jsonb_agg(y ORDER BY y DESC) FROM (
        SELECT DISTINCT EXTRACT(YEAR FROM date_of_birth)::int AS y
        FROM public.patients WHERE date_of_birth IS NOT NULL
      ) s), '[]'::jsonb)
)
$$;

GRANT EXECUTE ON FUNCTION public.search_patients(text, text, text, int, int, timestamptz, timestamptz, text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patient_filter_options() TO authenticated;
