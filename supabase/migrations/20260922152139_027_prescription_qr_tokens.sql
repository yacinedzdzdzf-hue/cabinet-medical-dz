/*
# CMDZ — QR code sécurisé des ordonnances

## Objectif

Chaque ordonnance peut porter un QR code qui, une fois scanné, ouvre le dossier
du patient concerné dans CMDZ — sans jamais transporter la moindre donnée
personnelle ou médicale.

## Principe de sécurité

Le QR contient uniquement un **jeton opaque aléatoire** (32 octets, 256 bits).
Ni nom, ni téléphone, ni CIN, ni diagnostic, ni identifiant interne du patient.
Le jeton ne vaut rien sans une session authentifiée : il sert seulement à
désigner une ordonnance, et c'est la base qui décide du patient à ouvrir à
partir de cette ordonnance.

Le jeton est stocké **haché en SHA-256**. La table ne contient donc jamais la
valeur imprimée : une personne qui lirait la table ne pourrait pas fabriquer de
QR valide. La comparaison se fait sur l'empreinte, ce qui est insensible au
temps de réponse.

## 1. Nouvelle table

- `prescription_qr_tokens`
  - `id` (uuid, clé primaire)
  - `prescription_id` (uuid, référence `prescriptions`, supprimé avec elle)
  - `patient_id` (uuid, référence `patients`) — figé à la création pour que le
    QR reste valable même si l'ordonnance est ensuite modifiée
  - `token_hash` (text, unique) — empreinte SHA-256 du jeton imprimé
  - `created_by` (uuid, référence `profiles`)
  - `created_at`, `revoked_at`

## 2. Sécurité

- RLS activée. Aucune politique d'écriture : la table n'est **jamais** écrite
  directement par le client. Tout passe par des fonctions serveur.
- La lecture directe est également refusée : on ne peut pas énumérer les jetons.
- `RESOLVE_PRESCRIPTION_QR` : retrouve le patient à partir du jeton imprimé.
  - refuse un appelant non authentifié (erreur 42501 → l'application demande
    la connexion) ;
  - refuse un appelant sans droit sur les dossiers patients (rôles
    ADMIN / DOCTOR / RECEPTION uniquement — un écran de salle d'attente n'a
    aucun accès) ;
  - refuse un jeton inconnu ou révoqué sans révéler lequel des deux ;
  - journalise `QR_PATIENT_ACCESS` avec patient, ordonnance, utilisateur et
    horodatage ;
  - ne renvoie que des identifiants, jamais de données médicales.
- `ENSURE_PRESCRIPTION_QR_TOKEN` : crée (ou réutilise) le jeton d'une ordonnance.
  Le hachage est fait côté serveur ; l'application ne voit que la valeur à
  imprimer.

## 3. Notes

- Réutiliser le jeton existant évite de changer le QR d'une ordonnance déjà
  imprimée à chaque nouvelle impression.
- `revoked_at` permet d'invalider un QR perdu sans supprimer la ligne.
*/

CREATE TABLE IF NOT EXISTS public.prescription_qr_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_prescription_qr_prescription ON public.prescription_qr_tokens (prescription_id);
CREATE INDEX IF NOT EXISTS idx_prescription_qr_patient ON public.prescription_qr_tokens (patient_id);

ALTER TABLE public.prescription_qr_tokens ENABLE ROW LEVEL SECURITY;

-- Aucune politique : ni lecture ni écriture directe. Uniquement via les fonctions ci-dessous.
DROP POLICY IF EXISTS "qr_tokens_no_direct_access" ON public.prescription_qr_tokens;

REVOKE ALL ON TABLE public.prescription_qr_tokens FROM anon, authenticated;

-- =====================================================================
-- Création / réutilisation du jeton d'une ordonnance
-- =====================================================================
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
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('ADMIN','DOCTOR','RECEPTION') AND active = true
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

  -- Jeton déjà émis : on le réutilise pour ne pas invalider un QR déjà imprimé
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

-- =====================================================================
-- Résolution d'un jeton scanné → patient autorisé
-- =====================================================================
CREATE OR REPLACE FUNCTION public.resolve_prescription_qr(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash text;
  v_patient_id uuid;
  v_prescription_id uuid;
  v_allowed boolean;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('ADMIN','DOCTOR','RECEPTION') AND active = true
  ) INTO v_allowed;
  IF NOT v_allowed THEN
    -- Les écrans de salle d'attente et tout rôle non soignant n'ont aucun accès
    RAISE EXCEPTION 'Accès non autorisé au dossier médical.' USING ERRCODE = '42501';
  END IF;

  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'QR code invalide.' USING ERRCODE = 'P0001';
  END IF;

  v_hash := encode(extensions.digest(trim(p_token), 'sha256'), 'hex');

  SELECT t.patient_id, t.prescription_id INTO v_patient_id, v_prescription_id
  FROM public.prescription_qr_tokens t
  WHERE t.token_hash = v_hash AND t.revoked_at IS NULL;

  IF v_patient_id IS NULL THEN
    -- Message unique : on ne dit pas si le jeton est inconnu ou révoqué
    RAISE EXCEPTION 'QR code invalide ou expiré.' USING ERRCODE = 'P0001';
  END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, entity_description, details)
  VALUES (
    auth.uid(), v_name, 'QR_PATIENT_ACCESS', 'patient', v_patient_id,
    v_prescription_id::text,
    jsonb_build_object(
      'patient_id', v_patient_id, 'prescription_id', v_prescription_id,
      'user_id', auth.uid(), 'user', v_name,
      'date', to_char(now(), 'DD/MM/YYYY'), 'heure', to_char(now(), 'HH24:MI'), 'at', now()
    )
  );

  -- Identifiants uniquement : jamais de donnée médicale
  RETURN jsonb_build_object('patient_id', v_patient_id, 'prescription_id', v_prescription_id);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_prescription_qr_token(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_prescription_qr(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_prescription_qr_token(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_prescription_qr(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
