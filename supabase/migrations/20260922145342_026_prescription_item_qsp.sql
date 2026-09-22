/*
# CMDZ — QSP sur les lignes d'ordonnance

Ajoute la mention « QSP — Quantité suffisante pour » sur chaque médicament
(ex. « 5 jours », « 1 mois »). Champ libre : s'il est vide, l'ordonnance
n'affiche rien du tout pour le QSP.
*/

ALTER TABLE public.prescription_items ADD COLUMN IF NOT EXISTS qsp text;
