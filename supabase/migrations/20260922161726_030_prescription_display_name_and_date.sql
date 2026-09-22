/*
# CMDZ — Nom imprimé et date réelle de l'ordonnance

## Objectif

Deux informations manquaient pour que l'ordonnance corresponde exactement à ce
que le médecin veut imprimer :

1. **Nom imprimé sur l'ordonnance** (`patient_display_name`)

   Le nom du patient est actuellement lu dans la table `patients`. Le médecin
   doit pouvoir corriger ce nom pour une ordonnance donnée (par exemple ajouter
   une précision, corriger une majuscule) **sans modifier le dossier global du
   patient**. On conserve donc une copie du nom au moment de l'ordonnance.

   `patient_id` reste la référence principale : la copie n'est qu'un texte
   d'affichage. Si elle est vide, l'application retombe sur le nom réel du
   patient.

2. **Date de prescription** (`prescription_date`)

   Jusqu'ici la seule date disponible était `created_at` (moment de création en
   base). Le médecin doit pouvoir choisir une autre date, par exemple pour une
   ordonnance antidatée ou rédigée à l'avance. On stocke cette date choisie.

## 1. Nouvelles colonnes

- `prescriptions.patient_display_name` (text, nullable) — nom imprimé
- `prescriptions.prescription_date` (date, nullable) — date choisie

## 2. Données existantes

Les ordonnances déjà enregistrées sont conservées. Leur `prescription_date` est
initialisée à partir de leur date de création, pour qu'aucune ordonnance
existante ne se retrouve sans date.

## 3. Notes

- Colonnes nullables : aucune donnée n'est perdue ni réécrite en dehors de ce
  remplissage initial.
- Aucune politique RLS n'est modifiée : les règles existantes sur
  `prescriptions` couvrent déjà ces colonnes.
*/

ALTER TABLE public.prescriptions ADD COLUMN IF NOT EXISTS patient_display_name text;
ALTER TABLE public.prescriptions ADD COLUMN IF NOT EXISTS prescription_date date;

-- Reprend la date de création pour les ordonnances déjà enregistrées
UPDATE public.prescriptions
SET prescription_date = created_at::date
WHERE prescription_date IS NULL;

NOTIFY pgrst, 'reload schema';
