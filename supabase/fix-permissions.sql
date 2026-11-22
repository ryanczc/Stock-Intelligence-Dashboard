-- Run once in Supabase > SQL Editor if the data job or website gets "403 Forbidden".
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant execute on function is_owner() to anon, authenticated, service_role;
