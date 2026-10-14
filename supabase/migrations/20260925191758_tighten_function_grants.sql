-- Starsys: lock down who can call each function over the REST API (/rest/v1/rpc).
-- Role checks inside each function remain the real authorization layer.

-- Internal-only helpers (never callable from the browser)
revoke execute on function public.can_manage_user(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user()     from public, anon, authenticated;
grant  execute on function public.can_manage_user(uuid) to service_role;
grant  execute on function public.handle_new_user()     to service_role;

-- App-callable functions: signed-in users only, never anonymous
revoke execute on function public.add_church(text, text)                      from public, anon;
revoke execute on function public.add_district(text)                          from public, anon;
revoke execute on function public.approve_user(uuid)                          from public, anon;
revoke execute on function public.grant_support_access(text, text, integer, jsonb) from public, anon;
revoke execute on function public.is_admin_or_super()                         from public, anon;
revoke execute on function public.is_super_admin()                            from public, anon;
revoke execute on function public.promote_to_admin(uuid)                      from public, anon;
revoke execute on function public.record_login()                              from public, anon;
revoke execute on function public.remove_church(text, text)                   from public, anon;
revoke execute on function public.remove_district(text)                       from public, anon;
revoke execute on function public.rename_church(text, text, text)             from public, anon;
revoke execute on function public.rename_district(text, text)                 from public, anon;
revoke execute on function public.revoke_support_access(uuid)                 from public, anon;
revoke execute on function public.set_user_districts(uuid, text[])            from public, anon;
revoke execute on function public.set_user_status(uuid, text)                 from public, anon;
revoke execute on function public.user_has_district_access(text)             from public, anon;

grant execute on function public.add_church(text, text)                       to authenticated, service_role;
grant execute on function public.add_district(text)                           to authenticated, service_role;
grant execute on function public.approve_user(uuid)                           to authenticated, service_role;
grant execute on function public.grant_support_access(text, text, integer, jsonb) to authenticated, service_role;
grant execute on function public.is_admin_or_super()                          to authenticated, service_role;
grant execute on function public.is_super_admin()                             to authenticated, service_role;
grant execute on function public.promote_to_admin(uuid)                       to authenticated, service_role;
grant execute on function public.record_login()                               to authenticated, service_role;
grant execute on function public.remove_church(text, text)                    to authenticated, service_role;
grant execute on function public.remove_district(text)                        to authenticated, service_role;
grant execute on function public.rename_church(text, text, text)              to authenticated, service_role;
grant execute on function public.rename_district(text, text)                  to authenticated, service_role;
grant execute on function public.revoke_support_access(uuid)                  to authenticated, service_role;
grant execute on function public.set_user_districts(uuid, text[])             to authenticated, service_role;
grant execute on function public.set_user_status(uuid, text)                  to authenticated, service_role;
grant execute on function public.user_has_district_access(text)               to authenticated, service_role;
