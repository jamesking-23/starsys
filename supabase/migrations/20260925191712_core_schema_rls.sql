-- Starsys: row level security (reconstructed from live DB).
-- Writes to most tables go through the SECURITY DEFINER RPCs, so only a few
-- tables have direct insert/update policies.

alter table public.admin_scope          enable row level security;
alter table public.audit                enable row level security;
alter table public.audit_log            enable row level security;
alter table public.churches             enable row level security;
alter table public.districts            enable row level security;
alter table public.entries              enable row level security;
alter table public.offering_types       enable row level security;
alter table public.profiles             enable row level security;
alter table public.support_access       enable row level security;
alter table public.system_config        enable row level security;
alter table public.user_district_access enable row level security;

create policy admin_scope_select on public.admin_scope as permissive for select to public
  using (((admin_id = auth.uid()) OR is_admin_or_super()));

create policy audit_insert on public.audit as permissive for insert to public
  with check (user_has_district_access(district));
create policy audit_select on public.audit as permissive for select to public
  using ((is_admin_or_super() AND user_has_district_access(district)));

create policy audit_log_select on public.audit_log as permissive for select to public
  using (is_admin_or_super());

create policy churches_select on public.churches as permissive for select to public
  using ((auth.uid() IS NOT NULL));

create policy districts_select on public.districts as permissive for select to public
  using ((auth.uid() IS NOT NULL));

create policy entries_select on public.entries as permissive for select to public
  using (user_has_district_access(district));
create policy entries_insert on public.entries as permissive for insert to public
  with check (user_has_district_access(district));
create policy entries_update on public.entries as permissive for update to public
  using (user_has_district_access(district))
  with check (user_has_district_access(district));

create policy offering_types_select on public.offering_types as permissive for select to public
  using ((auth.uid() IS NOT NULL));
create policy offering_types_write on public.offering_types as permissive for all to public
  using (is_admin_or_super())
  with check (is_admin_or_super());

create policy profiles_select on public.profiles as permissive for select to public
  using (((id = auth.uid()) OR is_admin_or_super()));
create policy profiles_update_self on public.profiles as permissive for update to public
  using ((id = auth.uid()))
  with check ((id = auth.uid()));

create policy support_access_select on public.support_access as permissive for select to public
  using (is_super_admin());

create policy system_config_select on public.system_config as permissive for select to public
  using (true);

create policy uda_select on public.user_district_access as permissive for select to public
  using (((user_id = auth.uid()) OR is_admin_or_super()));
