-- ============================================================================
-- Bucket público para las imágenes de Open Plays. Hasta ahora `open_plays.image`
-- guardaba la foto como data URL directo en la fila -- y una serie recurrente
-- repite la MISMA imagen en cada ocurrencia (una fila por semana), así que el
-- mismo archivo quedaba duplicado N veces en la base de datos y viajaba
-- duplicado N veces cada vez que alguien cargaba la lista de Actividades.
-- Con esto, addOpenPlay() sube el archivo UNA vez y todas las ocurrencias de
-- la serie guardan la misma URL pública (unos pocos bytes en vez de ~100-200KB
-- por fila) -- exactamente lo que el comentario original de schema.sql ya
-- preveía ("image text -- data URL o URL de Supabase Storage").
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('open-play-images', 'open-play-images', true)
on conflict (id) do nothing;

create policy "public read open-play-images"
  on storage.objects for select
  using (bucket_id = 'open-play-images');

create policy "admin write open-play-images"
  on storage.objects for insert
  with check (bucket_id = 'open-play-images' and public.is_admin());

create policy "admin update open-play-images"
  on storage.objects for update
  using (bucket_id = 'open-play-images' and public.is_admin());

create policy "admin delete open-play-images"
  on storage.objects for delete
  using (bucket_id = 'open-play-images' and public.is_admin());
