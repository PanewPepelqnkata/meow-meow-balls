-- Add email column to profiles so username-based login can look up the
-- auth email client-side (auth.users is not readable from the client).
alter table public.profiles add column if not exists email text;

-- Backfill email for existing users from auth.users.
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

-- Populate email atomically at signup via the trigger, avoiding the
-- race between profile creation and a client-side update.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, display_name, avatar_url, email)
  values (
    new.id,
    new.raw_user_meta_data->>'username',
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'username'),
    new.raw_user_meta_data->>'avatar_url',
    new.email
  );
  return new;
end;
$$ language plpgsql security definer;

-- The existing "Public profiles are viewable by everyone" select policy
-- (using true) already covers the email column, so anonymous clients can
-- resolve username -> email for login.
