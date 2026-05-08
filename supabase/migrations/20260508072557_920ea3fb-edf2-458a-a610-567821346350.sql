
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
UPDATE public.items SET claimed_at = updated_at WHERE status = 'claimed' AND claimed_at IS NULL;

DROP POLICY IF EXISTS items_select_public ON public.items;
CREATE POLICY items_select_public ON public.items
FOR SELECT USING (
  status = 'lost'
  OR (status = 'claimed' AND claimed_at IS NOT NULL AND claimed_at > now() - interval '7 days')
  OR submitted_by = auth.uid()
  OR has_role(auth.uid(), 'admin')
);

DROP FUNCTION IF EXISTS public.match_items(vector, integer, double precision);
DROP FUNCTION IF EXISTS public.fuzzy_search_items(text, integer);

CREATE FUNCTION public.match_items(query_embedding vector, match_count integer DEFAULT 20, similarity_threshold double precision DEFAULT 0.15)
RETURNS TABLE(id bigint, title text, description text, category text, location_found text, photo_url text, status text, created_at timestamptz, claimed_at timestamptz, similarity double precision)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT i.id, i.title, i.description, i.category, i.location_found, i.photo_url, i.status, i.created_at, i.claimed_at,
         1 - (i.embedding <=> query_embedding) AS similarity
  FROM public.items i
  WHERE (i.status = 'lost'
         OR (i.status = 'claimed' AND i.claimed_at IS NOT NULL AND i.claimed_at > now() - interval '7 days'))
    AND i.embedding IS NOT NULL
    AND 1 - (i.embedding <=> query_embedding) > similarity_threshold
  ORDER BY i.embedding <=> query_embedding
  LIMIT match_count;
$$;

CREATE FUNCTION public.fuzzy_search_items(q text, match_count integer DEFAULT 20)
RETURNS TABLE(id bigint, title text, description text, category text, location_found text, photo_url text, status text, created_at timestamptz, claimed_at timestamptz, similarity real)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT i.id, i.title, i.description, i.category, i.location_found, i.photo_url, i.status, i.created_at, i.claimed_at,
    GREATEST(
      similarity(coalesce(i.title,''), q),
      similarity(coalesce(i.description,''), q),
      similarity(coalesce(i.category,''), q),
      similarity(coalesce(i.location_found,''), q)
    ) AS sim
  FROM public.items i
  WHERE (i.status = 'lost'
         OR (i.status = 'claimed' AND i.claimed_at IS NOT NULL AND i.claimed_at > now() - interval '7 days'))
    AND (
      coalesce(i.title,'') %  q OR
      coalesce(i.description,'') % q OR
      coalesce(i.category,'') % q OR
      coalesce(i.location_found,'') % q OR
      coalesce(i.title,'') ILIKE '%'||q||'%' OR
      coalesce(i.description,'') ILIKE '%'||q||'%' OR
      coalesce(i.location_found,'') ILIKE '%'||q||'%' OR
      coalesce(i.category,'') ILIKE '%'||q||'%'
    )
  ORDER BY sim DESC
  LIMIT match_count;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN
  PERFORM cron.unschedule('delete-expired-claimed-items');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'delete-expired-claimed-items',
  '0 3 * * *',
  $$ DELETE FROM public.items WHERE status = 'claimed' AND claimed_at IS NOT NULL AND claimed_at < now() - interval '7 days'; $$
);
