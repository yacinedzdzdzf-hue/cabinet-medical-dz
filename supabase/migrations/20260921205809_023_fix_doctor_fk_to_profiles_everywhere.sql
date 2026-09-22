/*
# CMDZ — CORRECTION DU BUG : relations « médecin » vers profiles

## Cause réelle de l'erreur « Impossible de charger les consultations »

Les requêtes de l'application utilisent la relation imbriquée `doctor:profiles(*)`,
ce qui demande à PostgREST de joindre `consultations` → `profiles`.
Or la clé étrangère `consultations.doctor_id` pointait vers `auth.users(id)`, pas
vers `profiles(id)` : le schéma `auth` n'étant pas exposé par l'API, PostgREST
répondait par une erreur, et l'historique des consultations s'affichait vide avec
le message d'erreur.

La migration 012 avait déjà corrigé `appointments` de la même façon. On aligne
ici toutes les autres colonnes « médecin / soignant » sur `profiles`, ce qui rend
les relations PostgREST valides et fait apparaître le nom du médecin.

Aucune donnée n'est supprimée ni retypée : on ne remplace que la contrainte de
clé étrangère. Les vérifications montrent 0 référence orpheline.
*/

-- consultations
ALTER TABLE public.consultations DROP CONSTRAINT IF EXISTS consultations_doctor_id_fkey;
ALTER TABLE public.consultations
  ADD CONSTRAINT consultations_doctor_id_fkey
  FOREIGN KEY (doctor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- prescriptions
ALTER TABLE public.prescriptions DROP CONSTRAINT IF EXISTS prescriptions_doctor_id_fkey;
ALTER TABLE public.prescriptions
  ADD CONSTRAINT prescriptions_doctor_id_fkey
  FOREIGN KEY (doctor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- certificates
ALTER TABLE public.certificates DROP CONSTRAINT IF EXISTS certificates_doctor_id_fkey;
ALTER TABLE public.certificates
  ADD CONSTRAINT certificates_doctor_id_fkey
  FOREIGN KEY (doctor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- follow_ups
ALTER TABLE public.follow_ups DROP CONSTRAINT IF EXISTS follow_ups_doctor_id_fkey;
ALTER TABLE public.follow_ups
  ADD CONSTRAINT follow_ups_doctor_id_fkey
  FOREIGN KEY (doctor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- waiting_queue
ALTER TABLE public.waiting_queue DROP CONSTRAINT IF EXISTS waiting_queue_doctor_id_fkey;
ALTER TABLE public.waiting_queue
  ADD CONSTRAINT waiting_queue_doctor_id_fkey
  FOREIGN KEY (doctor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
