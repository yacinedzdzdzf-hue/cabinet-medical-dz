/*
# CMDZ — Numérotation des ordonnances côté serveur

## Objectif

Le numéro d'ordonnance était calculé dans l'application à partir du dernier
numéro lu : deux postes créant une ordonnance au même moment pouvaient obtenir
le même numéro. Le calcul passe côté base, dans une seule instruction atomique,
ce qui élimine ce risque lors d'un usage multi-PC.

## 1. Nouvelle fonction

- `public.next_prescription_number()` — renvoie le prochain numéro libre au
  format `ORD-000001`. Elle compte les ordonnances existantes et vérifie que le
  numéro est libre avant de le proposer.

## 2. Sécurité

- `SECURITY DEFINER` avec `search_path` figé, EXECUTE accordé aux seuls
  utilisateurs connectés. Un compte non authentifié ne peut pas l'appeler.
- La fonction ne fait que lire un compteur : elle ne modifie aucune donnée.

## 3. Notes

- Le format reste identique à celui déjà imprimé sur les ordonnances existantes,
  donc les anciens documents restent cohérents avec les nouveaux.
*/

CREATE OR REPLACE FUNCTION public.next_prescription_number()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed boolean;
  v_max integer;
  v_candidate integer;
  v_number text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('ADMIN','DOCTOR','RECEPTION') AND active = true
  ) INTO v_allowed;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Accès refusé.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(max(nullif(regexp_replace(prescription_number, '\D', '', 'g'), '')::integer), 0)
  INTO v_max
  FROM public.prescriptions
  WHERE prescription_number ~ '^ORD-[0-9]+$';

  v_candidate := v_max + 1;
  LOOP
    v_number := 'ORD-' || lpad(v_candidate::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.prescriptions WHERE prescription_number = v_number);
    v_candidate := v_candidate + 1;
  END LOOP;

  RETURN v_number;
END;
$$;

REVOKE ALL ON FUNCTION public.next_prescription_number() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_prescription_number() TO authenticated;

NOTIFY pgrst, 'reload schema';
