-- Profile photo, stored as a small (320px) JPEG data URL so it shows everywhere the profile is shown.
alter table public.profiles add column if not exists avatar_url text;

-- Users can update their own profile row, so cap the size to keep that row small.
alter table public.profiles
  drop constraint if exists profiles_avatar_url_size_check;
alter table public.profiles
  add constraint profiles_avatar_url_size_check
  check (avatar_url is null or char_length(avatar_url) <= 300000);
