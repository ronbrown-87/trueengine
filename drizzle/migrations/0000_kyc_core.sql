create type public.app_role as enum ('admin', 'moderator', 'user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "Users read own roles" on public.user_roles for select to authenticated using (auth.uid() = user_id);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create sequence public.case_seq start 10001;

create table public.verifications (
  id uuid primary key default gen_random_uuid(),
  case_code text not null unique default ('VA-' || nextval('public.case_seq')::text),
  full_name text not null,
  doc_type text not null default 'National ID',
  doc_number text,
  date_of_birth text,
  expiry_date text,
  authenticity text not null default 'Unverified',
  face_match numeric,
  liveness text not null default 'Review',
  duplicate text not null default 'Clear',
  match_case_code text,
  match_similarity numeric,
  trust_score integer not null default 0,
  status text not null default 'Pending',
  ai_notes text,
  vector_hash text,
  document_path text,
  selfie_path text,
  processing_ms integer,
  review_reason text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, update on public.verifications to authenticated;
grant all on public.verifications to service_role;
grant usage on sequence public.case_seq to service_role;
alter table public.verifications enable row level security;
create policy "Admins read verifications" on public.verifications for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Admins update verifications" on public.verifications for update to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  event text not null,
  case_code text,
  created_at timestamptz not null default now()
);
grant select on public.audit_log to authenticated;
grant all on public.audit_log to service_role;
alter table public.audit_log enable row level security;
create policy "Admins read audit" on public.audit_log for select to authenticated using (public.has_role(auth.uid(), 'admin'));

create or replace function public.log_verification_review()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if new.status is distinct from old.status then
    select coalesce(auth.jwt() ->> 'email', 'system') into who;
    insert into public.audit_log(actor, event, case_code)
    values (who, 'Status changed ' || old.status || ' → ' || new.status || coalesce(' (reason: ' || new.review_reason || ')', ''), new.case_code);
  end if;
  return new;
end $$;
create trigger verifications_audit after update on public.verifications for each row execute function public.log_verification_review();

create policy "Admins read kyc media" on storage.objects for select to authenticated using (bucket_id = 'kyc-media' and public.has_role(auth.uid(), 'admin'));