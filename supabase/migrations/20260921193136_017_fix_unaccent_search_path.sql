/*
# CMDZ — Corrige le search_path mutable de immutable_unaccent

Les appels sont déjà qualifiés par schéma ; fixer le search_path supprime
l'avertissement du linter sans changer le résultat de la fonction.
*/

CREATE OR REPLACE FUNCTION public.immutable_unaccent(txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = pg_catalog, public
AS $$ SELECT public.unaccent('public.unaccent', txt) $$;
