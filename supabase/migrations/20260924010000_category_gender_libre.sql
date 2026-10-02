-- v2.90.1 -- INCIDENTE REAL: v2.76.0 agregó el género de categoría "Libre" (sin restricción de
-- género) a NewCategoryForm/GENDER_LABELS pero nunca se amplió el CHECK de la columna, que desde
-- el init solo acepta masculino/femenino/mixto. Resultado: crear una categoría "Libre" fallaba en
-- el INSERT y addCategory solo lo registraba en consola -- al admin simplemente "no lo dejaba
-- crear" sin ningún mensaje. No toca ninguna fila existente.
alter table public.categories drop constraint if exists categories_gender_check;
alter table public.categories add constraint categories_gender_check
  check (gender in ('masculino', 'femenino', 'mixto', 'libre'));
