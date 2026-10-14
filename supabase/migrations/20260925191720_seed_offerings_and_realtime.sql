-- Starsys: default offering types + realtime publication.
-- Only the standard offering categories are seeded. Any extra categories
-- (admins can add their own in the app) are tenant data, not schema.

insert into public.offering_types (key, label, sort_order) values
  ('tithe',    'Tithe',        0),
  ('combined', 'Combined',     1),
  ('camp',     'Camp',         2),
  ('c13th',    '13th Sabbath', 3),
  ('gc',       'GC',           4),
  ('hopeTV',   'Hope TV',      7),
  ('adra',     'ADRA',         8),
  ('others',   'Others',       9)
on conflict (key) do nothing;

-- Tables streamed to the browser via Supabase Realtime
alter publication supabase_realtime add table
  public.profiles, public.districts, public.churches, public.entries, public.offering_types;
