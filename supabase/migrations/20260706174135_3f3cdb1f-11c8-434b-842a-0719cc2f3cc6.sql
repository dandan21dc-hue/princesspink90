
create table public.partnership_inquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  email text not null,
  organization text,
  inquiry_type text,
  message text not null,
  status text not null default 'new' check (status in ('new','contacted','archived')),
  notes text
);
grant select, insert, update, delete on public.partnership_inquiries to authenticated;
grant insert on public.partnership_inquiries to anon;
grant all on public.partnership_inquiries to service_role;
alter table public.partnership_inquiries enable row level security;

create policy "Anyone can submit a partnership inquiry"
  on public.partnership_inquiries for insert to anon, authenticated
  with check (true);

create policy "Admins can read partnership inquiries"
  on public.partnership_inquiries for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create policy "Admins can update partnership inquiries"
  on public.partnership_inquiries for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create policy "Admins can delete partnership inquiries"
  on public.partnership_inquiries for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create trigger partnership_inquiries_touch_updated_at
  before update on public.partnership_inquiries
  for each row execute function public.touch_updated_at();

create table public.partnership_replies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  inquiry_id uuid not null references public.partnership_inquiries(id) on delete cascade,
  sent_by uuid references auth.users(id) on delete set null,
  subject text not null,
  body text not null
);
grant select, insert on public.partnership_replies to authenticated;
grant all on public.partnership_replies to service_role;
alter table public.partnership_replies enable row level security;

create policy "Admins can read partnership replies"
  on public.partnership_replies for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create policy "Admins can insert partnership replies"
  on public.partnership_replies for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin') and sent_by = auth.uid());

create index partnership_inquiries_status_created_idx
  on public.partnership_inquiries (status, created_at desc);
create index partnership_replies_inquiry_idx
  on public.partnership_replies (inquiry_id, created_at desc);
