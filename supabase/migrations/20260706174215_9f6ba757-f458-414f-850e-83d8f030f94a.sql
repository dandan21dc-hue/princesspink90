
drop policy "Anyone can submit a partnership inquiry" on public.partnership_inquiries;

create policy "Anyone can submit a partnership inquiry"
  on public.partnership_inquiries for insert to anon, authenticated
  with check (
    char_length(btrim(name)) between 1 and 200
    and char_length(btrim(email)) between 3 and 320
    and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and char_length(btrim(message)) between 1 and 5000
    and (organization is null or char_length(organization) <= 200)
    and (inquiry_type is null or inquiry_type in ('venue','sponsor','collab','media','other'))
    and status = 'new'
    and notes is null
  );
