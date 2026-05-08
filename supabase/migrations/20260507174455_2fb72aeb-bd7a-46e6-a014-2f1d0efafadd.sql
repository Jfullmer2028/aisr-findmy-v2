
CREATE EXTENSION IF NOT EXISTS vector;

-- PROFILES
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('student','admin')) DEFAULT 'student',
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- has_role helper (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND role = _role);
$$;

-- Auto-create profile on signup with email validation + role detection
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _email text := NEW.email;
  _role text;
BEGIN
  IF _email IS NULL OR _email NOT LIKE '%@aisr.org' THEN
    RAISE EXCEPTION 'Only @aisr.org emails are allowed';
  END IF;

  IF _email ~ '_[0-9]{4}@aisr\.org$' THEN
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ITEMS
CREATE TABLE public.items (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  title text NOT NULL,
  description text,
  category text,
  location_found text,
  photo_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('lost','claimed','collected','pending','rejected')),
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  embedding vector(1536)
);
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
CREATE INDEX items_embedding_idx ON public.items USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX items_status_idx ON public.items(status);
CREATE INDEX items_fts_idx ON public.items USING gin (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(location_found,'')));

-- CLAIMS
CREATE TABLE public.claims (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  item_id bigint REFERENCES public.items(id) ON DELETE CASCADE NOT NULL,
  claimant_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  claimant_name text,
  claimant_contact text,
  description text,
  proof_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','collected')),
  admin_response text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;

-- AUDIT LOG
CREATE TABLE public.audit_log (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  item_id bigint,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- updated_at trigger for items
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER items_touch BEFORE UPDATE ON public.items
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS POLICIES
-- profiles
CREATE POLICY "profiles_select_self_or_admin" ON public.profiles FOR SELECT
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE
  USING (auth.uid() = id);
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- items: public can SELECT lost/claimed; submitter & admin see all
CREATE POLICY "items_select_public" ON public.items FOR SELECT
  USING (status IN ('lost','claimed') OR submitted_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "items_insert_authenticated" ON public.items FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND submitted_by = auth.uid());
CREATE POLICY "items_update_owner_or_admin" ON public.items FOR UPDATE
  USING (submitted_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "items_delete_owner_or_admin" ON public.items FOR DELETE
  USING (submitted_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- claims
CREATE POLICY "claims_select_own_or_admin" ON public.claims FOR SELECT
  USING (claimant_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "claims_insert_authenticated" ON public.claims FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND claimant_id = auth.uid());
CREATE POLICY "claims_update_admin" ON public.claims FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

-- audit_log
CREATE POLICY "audit_select_admin" ON public.audit_log FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "audit_insert_admin" ON public.audit_log FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND admin_id = auth.uid());

-- STORAGE BUCKETS
INSERT INTO storage.buckets (id, name, public) VALUES ('items','items', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('proofs','proofs', true) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "items_bucket_read" ON storage.objects FOR SELECT USING (bucket_id = 'items');
CREATE POLICY "items_bucket_write" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'items' AND auth.uid() IS NOT NULL);
CREATE POLICY "items_bucket_update" ON storage.objects FOR UPDATE USING (bucket_id = 'items' AND auth.uid() IS NOT NULL);
CREATE POLICY "items_bucket_delete" ON storage.objects FOR DELETE USING (bucket_id = 'items' AND auth.uid() IS NOT NULL);

CREATE POLICY "proofs_bucket_read" ON storage.objects FOR SELECT USING (bucket_id = 'proofs');
CREATE POLICY "proofs_bucket_write" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'proofs' AND auth.uid() IS NOT NULL);

-- match_items RPC for semantic search
CREATE OR REPLACE FUNCTION public.match_items(query_embedding vector(1536), match_count int DEFAULT 20, similarity_threshold float DEFAULT 0.3)
RETURNS TABLE (id bigint, title text, description text, category text, location_found text, photo_url text, status text, created_at timestamptz, similarity float)
LANGUAGE sql STABLE
AS $$
  SELECT i.id, i.title, i.description, i.category, i.location_found, i.photo_url, i.status, i.created_at,
         1 - (i.embedding <=> query_embedding) AS similarity
  FROM public.items i
  WHERE i.status IN ('lost','claimed')
    AND i.embedding IS NOT NULL
    AND 1 - (i.embedding <=> query_embedding) > similarity_threshold
  ORDER BY i.embedding <=> query_embedding
  LIMIT match_count;
$$;
