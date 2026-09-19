-- v2.85.1, a pedido del club: el default de "a cuántos sets se juega" para una categoría
-- NUEVA pasa de 3 a 1. No toca ninguna fila existente -- las categorías que ya tienen `best_of`
-- guardado (con o sin draw generado) se quedan exactamente como están; esto solo cambia qué
-- valor recibe una categoría que se crea de aquí en adelante y no lo ha tocado nadie todavía.
alter table public.categories alter column best_of set default 1;
