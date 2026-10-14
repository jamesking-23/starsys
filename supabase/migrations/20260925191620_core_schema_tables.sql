-- Starsys: core tables.
-- NOTE: reconstructed from the live database catalog (the original migration
-- text is not stored by Supabase). Running the files in this folder in order
-- on a fresh project reproduces the production schema.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

create table public.districts (
  id uuid not null default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  constraint districts_pkey primary key (id),
  constraint districts_name_key unique (name)
);

create table public.churches (
  id uuid not null default gen_random_uuid(),
  district_id uuid not null,
  name text not null,
  created_at timestamptz not null default now(),
  constraint churches_pkey primary key (id),
  constraint churches_district_id_name_key unique (district_id, name),
  constraint churches_district_id_fkey foreign key (district_id) references public.districts(id) on delete cascade
);

create table public.profiles (
  id uuid not null,
  full_name text,
  email text,
  phone text,
  role text not null default 'audit_user',
  status text not null default 'pending_approval',
  last_login timestamptz,
  created_at timestamptz not null default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade,
  constraint profiles_role_check check (role = any (array['audit_user','admin','super_admin'])),
  constraint profiles_status_check check (status = any (array['pending_approval','active','suspended','deactivated']))
);

create table public.admin_scope (
  id bigint generated always as identity,
  admin_id uuid not null,
  district text,
  system_wide boolean not null default false,
  constraint admin_scope_pkey primary key (id),
  constraint admin_scope_admin_id_fkey foreign key (admin_id) references public.profiles(id) on delete cascade
);
create index admin_scope_admin_idx on public.admin_scope using btree (admin_id);

create table public.user_district_access (
  id bigint generated always as identity,
  user_id uuid not null,
  district text not null,
  constraint user_district_access_pkey primary key (id),
  constraint user_district_access_user_id_district_key unique (user_id, district),
  constraint user_district_access_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade
);
create index uda_user_idx on public.user_district_access using btree (user_id);

create table public.entries (
  id text not null,
  district text not null,
  church text not null,
  month text not null,
  year integer not null,
  serialno text,
  amounts jsonb not null default '{}'::jsonb,
  editedby text,
  editedat timestamptz,
  device text,
  late_fields jsonb not null default '{}'::jsonb,
  constraint entries_pkey primary key (id)
);
create index entries_district_idx on public.entries using btree (district);

create table public.audit (
  id bigint generated always as identity,
  ts timestamptz not null default now(),
  name text,
  role text,
  district text,
  church text,
  month text,
  year integer,
  device text,
  total numeric,
  status text,
  constraint audit_pkey primary key (id)
);
create index audit_district_idx on public.audit using btree (district);

create table public.audit_log (
  id bigint generated always as identity,
  created_at timestamptz not null default now(),
  actor_name text,
  actor_role text,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  constraint audit_log_pkey primary key (id)
);

create table public.offering_types (
  key text not null,
  label text not null,
  sort_order integer not null default 0,
  constraint offering_types_pkey primary key (key)
);

create table public.support_access (
  id uuid not null default gen_random_uuid(),
  account_email text not null,
  reason text not null,
  permissions jsonb not null default '{}'::jsonb,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint support_access_pkey primary key (id),
  constraint support_access_granted_by_fkey foreign key (granted_by) references public.profiles(id)
);

-- Single-row table: the first user to sign up becomes super_admin (see handle_new_user).
create table public.system_config (
  id boolean not null default true,
  initialized boolean not null default false,
  constraint system_config_pkey primary key (id),
  constraint system_config_singleton check (id)
);
insert into public.system_config (id, initialized) values (true, false) on conflict do nothing;
