-- Starsys: helper functions, admin RPCs and triggers (reconstructed from live DB).
-- All SECURITY DEFINER functions pin search_path and check the caller's role internally.

-- ---------- access helpers ----------
create or replace function public.is_admin_or_super()
 returns boolean language sql stable security definer set search_path to 'public' as $function$
  select coalesce((select role in ('admin','super_admin') from public.profiles where id = auth.uid()), false);
$function$;

create or replace function public.is_super_admin()
 returns boolean language sql stable security definer set search_path to 'public' as $function$
  select coalesce((select role = 'super_admin' from public.profiles where id = auth.uid()), false);
$function$;

create or replace function public.can_manage_user(p_target uuid)
 returns boolean language plpgsql stable security definer set search_path to 'public' as $function$
declare v_caller_role text; v_target_role text;
begin
  select role into v_caller_role from public.profiles where id = auth.uid();
  select role into v_target_role from public.profiles where id = p_target;
  if v_caller_role = 'super_admin' and coalesce(v_target_role,'') <> 'super_admin' then return true; end if;
  if v_caller_role = 'admin' and v_target_role = 'audit_user' then return true; end if;
  return false;
end;
$function$;

create or replace function public.user_has_district_access(p_district text)
 returns boolean language sql stable security definer set search_path to 'public' as $function$
  select case
    when (select role from public.profiles where id = auth.uid()) = 'super_admin' then true
    when (select role from public.profiles where id = auth.uid()) = 'admin' then
      exists(select 1 from public.admin_scope where admin_id = auth.uid() and (system_wide or district = p_district))
    when (select role from public.profiles where id = auth.uid()) = 'audit_user' then
      exists(select 1 from public.user_district_access where user_id = auth.uid() and district = p_district)
    else false
  end
  and coalesce((select status = 'active' from public.profiles where id = auth.uid()), false);
$function$;

-- ---------- sign-up / profile protection ----------
create or replace function public.handle_new_user()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_initialized boolean;
  v_full_name text;
  v_phone text;
begin
  select initialized into v_initialized from public.system_config where id = true;
  v_full_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1));
  v_phone := new.raw_user_meta_data->>'phone';

  if not coalesce(v_initialized, false) then
    insert into public.profiles (id, full_name, email, phone, role, status)
    values (new.id, v_full_name, new.email, v_phone, 'super_admin', 'active');
    update public.system_config set initialized = true where id = true;
    insert into public.audit_log (actor_name, actor_role, action, target_type, target_id, details)
    values (v_full_name, 'super_admin', 'system_initialized', 'user', new.id::text, jsonb_build_object('email', new.email));
  else
    insert into public.profiles (id, full_name, email, phone, role, status)
    values (new.id, v_full_name, new.email, v_phone, 'audit_user', 'pending_approval');
  end if;
  return new;
end;
$function$;

create or replace function public.profiles_protect_privileged_fields()
 returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if coalesce(current_setting('app.bypass_profile_guard', true), '') <> 'on' then
    new.role := old.role;
    new.status := old.status;
    new.last_login := old.last_login;
  end if;
  return new;
end;
$function$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger trg_protect_profile_fields before update on public.profiles
  for each row execute function public.profiles_protect_privileged_fields();

-- ---------- user administration ----------
create or replace function public.record_login()
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform set_config('app.bypass_profile_guard','on', true);
  update public.profiles set last_login = now() where id = auth.uid();
end;
$function$;

create or replace function public.approve_user(p_user_id uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_name text; v_role text; v_target_name text;
begin
  if not public.can_manage_user(p_user_id) then raise exception 'Not authorized to approve this user.'; end if;
  perform set_config('app.bypass_profile_guard','on', true);
  update public.profiles set status = 'active' where id = p_user_id;
  select full_name into v_target_name from public.profiles where id = p_user_id;
  select full_name, role into v_name, v_role from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_name, actor_role, action, target_type, target_id, details)
  values (v_name, v_role, 'approve_user', 'user', p_user_id::text, jsonb_build_object('target_name', v_target_name));
end;
$function$;

create or replace function public.set_user_status(p_user_id uuid, p_status text)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_name text; v_role text;
begin
  if p_status not in ('active','suspended','deactivated','pending_approval') then
    raise exception 'Invalid status.';
  end if;
  if not public.can_manage_user(p_user_id) then raise exception 'Not authorized to modify this user.'; end if;
  perform set_config('app.bypass_profile_guard','on', true);
  update public.profiles set status = p_status where id = p_user_id;
  select full_name, role into v_name, v_role from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_name, actor_role, action, target_type, target_id, details)
  values (v_name, v_role, 'set_user_status', 'user', p_user_id::text, jsonb_build_object('status', p_status));
end;
$function$;

create or replace function public.set_user_districts(p_user_id uuid, p_districts text[])
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_name text; v_role text;
begin
  if not public.can_manage_user(p_user_id) then raise exception 'Not authorized to modify this user.'; end if;
  delete from public.user_district_access where user_id = p_user_id;
  if p_districts is not null and array_length(p_districts,1) > 0 then
    insert into public.user_district_access(user_id, district)
    select p_user_id, d from unnest(p_districts) as d;
  end if;
  select full_name, role into v_name, v_role from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_name, actor_role, action, target_type, target_id, details)
  values (v_name, v_role, 'set_user_districts', 'user', p_user_id::text, jsonb_build_object('districts', p_districts));
end;
$function$;

create or replace function public.promote_to_admin(p_user_id uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_name text; v_role text; v_target_role text;
begin
  if not public.is_super_admin() then raise exception 'Only a super admin can promote users.'; end if;
  select role into v_target_role from public.profiles where id = p_user_id;
  if v_target_role is distinct from 'audit_user' then raise exception 'Only audit users can be promoted.'; end if;
  perform set_config('app.bypass_profile_guard','on', true);
  update public.profiles set role = 'admin' where id = p_user_id;
  delete from public.user_district_access where user_id = p_user_id;
  delete from public.admin_scope where admin_id = p_user_id;
  insert into public.admin_scope(admin_id, system_wide) values (p_user_id, true);
  select full_name, role into v_name, v_role from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_name, actor_role, action, target_type, target_id, details)
  values (v_name, v_role, 'promote_to_admin', 'user', p_user_id::text, '{}'::jsonb);
end;
$function$;

-- ---------- districts & churches ----------
create or replace function public.add_district(p_name text)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_name text; v_role text;
begin
  if not public.is_admin_or_super() then raise exception 'Not authorized.'; end if;
  insert into public.districts(name) values (p_name);
  select full_name, role into v_name, v_role from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_name, actor_role, action, target_type, target_id, details)
  values (v_name, v_role, 'add_district', 'district', p_name, '{}'::jsonb);
end;
$function$;

create or replace function public.rename_district(p_old_name text, p_new_name text)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_name text; v_role text;
begin
  if not public.is_admin_or_super() then raise exception 'Not authorized.'; end if;
  update public.districts set name = p_new_name where name = p_old_name;
  update public.user_district_access set district = p_new_name where district = p_old_name;
  update public.admin_scope set district = p_new_name where district = p_old_name;
  update public.entries set district = p_new_name where district = p_old_name;
  update public.audit set district = p_new_name where district = p_old_name;
  select full_name, role into v_name, v_role from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_name, actor_role, action, target_type, target_id, details)
  values (v_name, v_role, 'rename_district', 'district', p_new_name, jsonb_build_object('old_name', p_old_name));
end;
$function$;

create or replace function public.remove_district(p_name text)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_name text; v_role text; v_count int;
begin
  if not public.is_admin_or_super() then raise exception 'Not authorized.'; end if;
  select count(*) into v_count from public.entries where district = p_name;
  if v_count > 0 then raise exception 'Cannot remove a district with existing financial records.'; end if;
  delete from public.user_district_access where district = p_name;
  delete from public.admin_scope where district = p_name;
  delete from public.districts where name = p_name;
  select full_name, role into v_name, v_role from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_name, actor_role, action, target_type, target_id, details)
  values (v_name, v_role, 'remove_district', 'district', p_name, '{}'::jsonb);
end;
$function$;

create or replace function public.add_church(p_district text, p_name text)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_did uuid; v_name text; v_role text;
begin
  if not public.is_admin_or_super() then raise exception 'Not authorized.'; end if;
  select id into v_did from public.districts where name = p_district;
  if v_did is null then raise exception 'District not found.'; end if;
  insert into public.churches(district_id, name) values (v_did, p_name);
  select full_name, role into v_name, v_role from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_name, actor_role, action, target_type, target_id, details)
  values (v_name, v_role, 'add_church', 'church', p_name, jsonb_build_object('district', p_district));
end;
$function$;

create or replace function public.rename_church(p_district text, p_old_name text, p_new_name text)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_did uuid; v_name text; v_role text;
begin
  if not public.is_admin_or_super() then raise exception 'Not authorized.'; end if;
  select id into v_did from public.districts where name = p_district;
  if v_did is null then raise exception 'District not found.'; end if;
  update public.churches set name = p_new_name where district_id = v_did and name = p_old_name;
  update public.entries set church = p_new_name where district = p_district and church = p_old_name;
  update public.audit set church = p_new_name where district = p_district and church = p_old_name;
  select full_name, role into v_name, v_role from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_name, actor_role, action, target_type, target_id, details)
  values (v_name, v_role, 'rename_church', 'church', p_new_name, jsonb_build_object('district', p_district, 'old_name', p_old_name));
end;
$function$;

create or replace function public.remove_church(p_district text, p_name text)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_did uuid; v_name text; v_role text; v_count int;
begin
  if not public.is_admin_or_super() then raise exception 'Not authorized.'; end if;
  select id into v_did from public.districts where name = p_district;
  if v_did is null then raise exception 'District not found.'; end if;
  select count(*) into v_count from public.entries where district = p_district and church = p_name;
  if v_count > 0 then raise exception 'Cannot remove a church with existing financial records.'; end if;
  delete from public.churches where district_id = v_did and name = p_name;
  select full_name, role into v_name, v_role from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_name, actor_role, action, target_type, target_id, details)
  values (v_name, v_role, 'remove_church', 'church', p_name, jsonb_build_object('district', p_district));
end;
$function$;

-- ---------- support access ----------
create or replace function public.grant_support_access(p_account_email text, p_reason text, p_hours integer, p_permissions jsonb)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_name text; v_role text; v_id uuid;
begin
  if not public.is_super_admin() then raise exception 'Only a super admin can grant support access.'; end if;
  insert into public.support_access(account_email, reason, permissions, granted_by, granted_at, expires_at)
  values (p_account_email, p_reason, coalesce(p_permissions,'{}'::jsonb), auth.uid(), now(), now() + make_interval(hours => coalesce(p_hours,4)))
  returning id into v_id;
  select full_name, role into v_name, v_role from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_name, actor_role, action, target_type, target_id, details)
  values (v_name, v_role, 'grant_support_access', 'support_access', v_id::text, jsonb_build_object('email', p_account_email, 'hours', p_hours));
end;
$function$;

create or replace function public.revoke_support_access(p_id uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_name text; v_role text;
begin
  if not public.is_super_admin() then raise exception 'Only a super admin can revoke support access.'; end if;
  update public.support_access set revoked_at = now() where id = p_id;
  select full_name, role into v_name, v_role from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_name, actor_role, action, target_type, target_id, details)
  values (v_name, v_role, 'revoke_support_access', 'support_access', p_id::text, '{}'::jsonb);
end;
$function$;
