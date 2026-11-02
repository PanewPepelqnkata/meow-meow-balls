-- Add display_name column to profiles
alter table public.profiles add column if not exists display_name text;

-- Update existing rows to use username as display_name
update public.profiles set display_name = username where display_name is null;

-- Update trigger to use display_name if provided
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'username',
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'username'),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;
