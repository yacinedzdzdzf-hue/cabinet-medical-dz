/*
# CMDZ — Alignement des droits de numérotation des ordonnances

## Problème corrigé

`next_prescription_number()` autorisait le rôle RECEPTION, alors que la table
`prescriptions` n'autorise que ADMIN et DOCTOR à créer une ordonnance
(politique `prescriptions_insert_doctor`).

La numérotation restait donc possible pour un rôle qui n'aurait de toute façon
pas pu enregistrer l'ordonnance : incohérence entre la fonction et la règle
d'accès réelle de la table.

## Correction

La fonction applique désormais exactement la même règle que la création
d'ordonnance : ADMIN ou DOCTOR, compte actif. Aucune donnée n'est modifiée et
aucun numéro existant n'est affecté.
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
  -- Même règle que la politique d'insertion sur les ordonnances
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('ADMIN','DOCTOR') AND active = true
  ) INTO v_allowed;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Accès refusé : votre rôle ne permet pas de créer une ordonnance.'
      USING ERRCODE = '42501';
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
