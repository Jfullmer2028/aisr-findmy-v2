
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _email text := lower(NEW.email);
  _role text;
BEGIN
  IF _email IS NULL OR _email NOT LIKE '%@aisr.org' THEN
    RAISE EXCEPTION 'Only @aisr.org emails are allowed';
  END IF;

  IF _email = 'jfullmer_2028@aisr.org' THEN
    _role := 'admin';
  ELSIF _email ~ '_[0-9]{4}@aisr\.org$' THEN
    _role := 'student';
  ELSE
    _role := 'admin';
  END IF;

  INSERT INTO public.profiles (id, email, role, full_name)
  VALUES (NEW.id, _email, _role, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'))
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Promote existing user if already signed up
UPDATE public.profiles SET role = 'admin' WHERE email = 'jfullmer_2028@aisr.org';
