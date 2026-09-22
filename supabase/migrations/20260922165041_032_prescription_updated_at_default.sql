/*
# Date de dernière modification : valeur de départ à la création

## Problème corrigé

La migration précédente a ajouté `prescriptions.updated_at`, alimentée par un
déclencheur qui se déclenche **à la modification**. Conséquence : une ordonnance
qui vient d'être créée n'avait **aucune** date de dernière modification — le
champ restait vide jusqu'à la première retouche. L'historique ne pouvait donc
pas afficher « Dernière modification » pour une ordonnance jamais modifiée.

## Correction

`updated_at` reçoit une valeur par défaut (`now()`), posée à la création.
Résultat :

- ordonnance créée : `updated_at` = date de création ;
- ordonnance modifiée : `updated_at` = date et heure de la modification ;
- `created_at` n'est jamais touché, il reste la date de création d'origine.

## Notes

- Aucune donnée n'est supprimée.
- Les ordonnances déjà enregistrées qui auraient une date vide sont complétées
  à partir de leur date de création.
*/

ALTER TABLE public.prescriptions
ALTER COLUMN updated_at SET DEFAULT now();

UPDATE public.prescriptions
SET updated_at = created_at
WHERE updated_at IS NULL;

NOTIFY pgrst, 'reload schema';
