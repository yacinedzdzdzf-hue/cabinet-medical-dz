/*
# CMDZ — Retire l'exécution publique de start_consultation_from_queue

Par défaut, une nouvelle fonction est exécutable par PUBLIC (donc le rôle anon).
La fonction vérifie déjà le rôle de l'appelant, mais on restreint l'accès au
rôle `authenticated` par principe de moindre privilège.
*/

REVOKE ALL ON FUNCTION public.start_consultation_from_queue(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_consultation_from_queue(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_consultation_from_queue(uuid) TO authenticated;
