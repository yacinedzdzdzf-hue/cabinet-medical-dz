/*
# Règles d'accès aux ordonnances + date de dernière modification

## Objectif

Ce projet a trois rôles : ADMIN, DOCTOR et RECEPTION. Jusqu'ici, la réception
pouvait **lire** les ordonnances et leur contenu médical, sans pouvoir écrire.
Demande métier : la réception ne doit voir **aucun contenu médical** d'ordonnance.

Cette migration aligne donc les règles d'accès sur le métier réel, et ajoute une
date de dernière modification aux ordonnances.

## 1. Nouvelle colonne

- `prescriptions.updated_at` (timestamp with time zone)
  Date et heure de la dernière modification réelle de l'ordonnance.
  Alimentée automatiquement par un déclencheur à chaque `UPDATE`.
  Les ordonnances déjà enregistrées reçoivent leur date de création en valeur
  de départ, pour qu'aucune ne se retrouve sans date.

## 2. Modification des règles d'accès (RLS)

Table `prescriptions` :

| Action | Avant | Après |
|---|---|---|
| Lire | ADMIN, DOCTOR, RECEPTION | ADMIN, DOCTOR |
| Créer | ADMIN, DOCTOR | ADMIN, DOCTOR |
| Modifier | ADMIN, DOCTOR | ADMIN, DOCTOR |
| Supprimer | ADMIN, DOCTOR | ADMIN, DOCTOR |

Table `prescription_items` : mêmes règles (la réception perd la lecture).

Effet concret : une personne de la réception ne voit plus ni les ordonnances,
ni les médicaments prescrits, et ne peut ni créer, ni modifier, ni supprimer.
Les médecins et administrateurs gardent exactement tous leurs droits.

## 3. Sécurité des jetons QR

La fonction `ensure_prescription_qr_token` acceptait ADMIN, DOCTOR et RECEPTION.
Elle est désormais réservée aux ADMIN et DOCTOR, comme la création d'ordonnance :
la réception ne peut plus faire émettre un jeton QR.

`resolve_prescription_qr` reste accessible aux trois rôles, volontairement :
elle ne renvoie que des identifiants (aucune donnée médicale) et sert au scan
d'une ordonnance papier par l'accueil, qui a déjà accès aux dossiers patients.

## 4. Index de recherche

Ajout d'un index sur le numéro de dossier médical de `medical_files`, pour que la
recherche d'un patient par « DM » dans l'éditeur d'ordonnance reste rapide.
Un index sur le téléphone (`idx_patients_phone_trgm`) existe déjà : rien à faire.

## 5. Données existantes

Aucune table ni colonne n'est supprimée. Aucune ordonnance n'est supprimée.
Seule la colonne `updated_at` est remplie a posteriori pour les lignes existantes.
*/

-- ---------------------------------------------------------------------------
-- 1. Date de dernière modification
-- ---------------------------------------------------------------------------

ALTER TABLE public.prescriptions ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.prescriptions
SET updated_at = created_at
WHERE updated_at IS NULL;

CREATE OR REPLACE FUNCTION public.touch_prescriptions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prescriptions_updated_at ON public.prescriptions;
CREATE TRIGGER trg_prescriptions_updated_at
BEFORE UPDATE ON public.prescriptions
FOR EACH ROW
EXECUTE FUNCTION public.touch_prescriptions_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Règles d'accès : la réception perd la lecture du contenu des ordonnances
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS prescriptions_select_staff ON public.prescriptions;
CREATE POLICY prescriptions_select_medical ON public.prescriptions
FOR SELECT TO authenticated
USING (is_admin() OR is_doctor());

DROP POLICY IF EXISTS prescriptions_insert_doctor ON public.prescriptions;
CREATE POLICY prescriptions_insert_medical ON public.prescriptions
FOR INSERT TO authenticated
WITH CHECK (is_admin() OR is_doctor());

DROP POLICY IF EXISTS prescriptions_update_doctor ON public.prescriptions;
CREATE POLICY prescriptions_update_medical ON public.prescriptions
FOR UPDATE TO authenticated
USING (is_admin() OR is_doctor())
WITH CHECK (is_admin() OR is_doctor());

DROP POLICY IF EXISTS prescriptions_delete_doctor ON public.prescriptions;
CREATE POLICY prescriptions_delete_medical ON public.prescriptions
FOR DELETE TO authenticated
USING (is_admin() OR is_doctor());

DROP POLICY IF EXISTS presc_items_select_staff ON public.prescription_items;
CREATE POLICY presc_items_select_medical ON public.prescription_items
FOR SELECT TO authenticated
USING (is_admin() OR is_doctor());

DROP POLICY IF EXISTS presc_items_insert_doctor ON public.prescription_items;
CREATE POLICY presc_items_insert_medical ON public.prescription_items
FOR INSERT TO authenticated
WITH CHECK (is_admin() OR is_doctor());

DROP POLICY IF EXISTS presc_items_update_doctor ON public.prescription_items;
CREATE POLICY presc_items_update_medical ON public.prescription_items
FOR UPDATE TO authenticated
USING (is_admin() OR is_doctor())
WITH CHECK (is_admin() OR is_doctor());

DROP POLICY IF EXISTS presc_items_delete_doctor ON public.prescription_items;
CREATE POLICY presc_items_delete_medical ON public.prescription_items
FOR DELETE TO authenticated
USING (is_admin() OR is_doctor());

-- ---------------------------------------------------------------------------
-- 3. Jeton QR : émission réservée aux ADMIN et DOCTOR
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_prescription_qr_token(p_prescription_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_allowed boolean;
  v_patient_id uuid;
  v_existing_hash text;
  v_raw text;
  v_hash text;
BEGIN
  -- Même règle que la création d'ordonnance : ni réception, ni rôle inconnu
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('ADMIN','DOCTOR') AND active = true
  ) INTO v_allowed;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Accès refusé : votre rôle ne permet pas de générer un QR code.'
      USING ERRCODE = '42501';
  END IF;

  -- Le patient vient toujours de l'ordonnance, jamais d'un paramètre client
  SELECT patient_id INTO v_patient_id FROM public.prescriptions WHERE id = p_prescription_id;
  IF v_patient_id IS NULL THEN
    RAISE EXCEPTION 'Ordonnance introuvable.' USING ERRCODE = 'P0002';
  END IF;

  SELECT token_hash INTO v_existing_hash
  FROM public.prescription_qr_tokens
  WHERE prescription_id = p_prescription_id AND revoked_at IS NULL
  ORDER BY created_at DESC LIMIT 1;

  IF v_existing_hash IS NOT NULL THEN
    -- On ne peut pas réafficher un jeton dont on n'a que l'empreinte : on en
    -- émet un nouveau et on révoque l'ancien, ce qui garde un seul QR actif.
    UPDATE public.prescription_qr_tokens
    SET revoked_at = now()
    WHERE prescription_id = p_prescription_id AND revoked_at IS NULL;
  END IF;

  v_raw := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(extensions.digest(v_raw, 'sha256'), 'hex');

  INSERT INTO public.prescription_qr_tokens (prescription_id, patient_id, token_hash, created_by)
  VALUES (p_prescription_id, v_patient_id, v_hash, auth.uid());

  RETURN jsonb_build_object(
    'token', v_raw,
    'patient_id', v_patient_id,
    'prescription_id', p_prescription_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_prescription_qr_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_prescription_qr_token(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Recherche patient par numéro de dossier médical
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_medical_files_file_number_trgm
ON public.medical_files USING gin (file_number gin_trgm_ops);

NOTIFY pgrst, 'reload schema';
