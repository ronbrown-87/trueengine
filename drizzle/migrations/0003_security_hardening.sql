-- Security hardening
-- 1) Admins no longer UPDATE verifications directly; they use review_verification(), which can
--    only change review fields and always writes an audit entry.
-- 2) Direct UPDATE on verifications is revoked from signed-in users, so no other column can be edited from the browser.
-- 3) No self-service admin creation: seed the first admin manually (see bottom).

drop policy if exists "Admins update verifications" on public.verifications;
revoke update on public.verifications from authenticated;

create or replace function public.review_verification(_id uuid, _status text, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.verifications;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if _status not in ('Approved', 'Rejected') then
    raise exception 'invalid status';
  end if;
  select * into v from public.verifications where id = _id for update;
  if not found then raise exception 'not found'; end if;
  -- Overriding a duplicate flag requires a written reason, enforced server-side.
  if _status = 'Approved' and v.duplicate = 'Flagged' and coalesce(btrim(_reason), '') = '' then
    raise exception 'a reason is required to override a duplicate flag';
  end if;
  update public.verifications
     set status = _status,
         review_reason = nullif(left(btrim(_reason), 500), ''),
         reviewed_at = now()
   where id = _id;
  -- The existing verifications_audit trigger writes the audit entry (actor, status change, reason).
end $$;

revoke all on function public.review_verification(uuid, text, text) from public, anon;
grant execute on function public.review_verification(uuid, text, text) to authenticated;

-- has_role: callers may only ask about themselves (stops role enumeration of other users).
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
      and (auth.role() = 'service_role' or _user_id = auth.uid())
  )
$$;

-- Make sure the evidence bucket is private.
update storage.buckets set public = false where id = 'kyc-media';

-- FIRST ADMIN (run once, in the Supabase SQL editor, after that person signs up):
--   insert into public.user_roles (user_id, role)
--   select id, 'admin' from auth.users where email = 'you@example.com';
-- Then disable public sign-ups: Supabase Dashboard > Authentication > Sign In / Providers > "Allow new users to sign up" = off.
