-- v2.33.0: Torneos ahora pueden llevar una imagen de flyer promocional, igual que ya podían
-- Open Plays -- se pedía en Generalidades y no había forma de subirla. Mismo patrón que
-- open_plays.image (ver 20260816061000_open_play_images_storage.sql): la app sube el archivo
-- ya redimensionado/recomprimido a un bucket público y solo guarda la URL en la fila.
alter table public.tournaments add column if not exists image text;

insert into storage.buckets (id, name, public)
values ('tournament-images', 'tournament-images', true)
on conflict (id) do nothing;

create policy "public read tournament-images"
  on storage.objects for select
  using (bucket_id = 'tournament-images');

create policy "admin write tournament-images"
  on storage.objects for insert
  with check (bucket_id = 'tournament-images' and public.is_admin());

create policy "admin update tournament-images"
  on storage.objects for update
  using (bucket_id = 'tournament-images' and public.is_admin());

create policy "admin delete tournament-images"
  on storage.objects for delete
  using (bucket_id = 'tournament-images' and public.is_admin());
