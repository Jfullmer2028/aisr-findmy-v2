
-- Enable trigram for fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Restrict public visibility to 'lost' only (admins/owners still see all)
DROP POLICY IF EXISTS items_select_public ON public.items;
CREATE POLICY items_select_public ON public.items
FOR SELECT USING (
  (status = 'lost') OR (submitted_by = auth.uid()) OR has_role(auth.uid(), 'admin')
);

-- Update match_items to only return 'lost'
CREATE OR REPLACE FUNCTION public.match_items(query_embedding vector, match_count integer DEFAULT 20, similarity_threshold double precision DEFAULT 0.15)
 RETURNS TABLE(id bigint, title text, description text, category text, location_found text, photo_url text, status text, created_at timestamptz, similarity double precision)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT i.id, i.title, i.description, i.category, i.location_found, i.photo_url, i.status, i.created_at,
         1 - (i.embedding <=> query_embedding) AS similarity
  FROM public.items i
  WHERE i.status = 'lost'
    AND i.embedding IS NOT NULL
    AND 1 - (i.embedding <=> query_embedding) > similarity_threshold
  ORDER BY i.embedding <=> query_embedding
  LIMIT match_count;
$function$;

-- Trigram fuzzy search RPC
CREATE OR REPLACE FUNCTION public.fuzzy_search_items(q text, match_count integer DEFAULT 20)
 RETURNS TABLE(id bigint, title text, description text, category text, location_found text, photo_url text, status text, created_at timestamptz, similarity real)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT i.id, i.title, i.description, i.category, i.location_found, i.photo_url, i.status, i.created_at,
    GREATEST(
      similarity(coalesce(i.title,''), q),
      similarity(coalesce(i.description,''), q),
      similarity(coalesce(i.category,''), q),
      similarity(coalesce(i.location_found,''), q)
    ) AS sim
  FROM public.items i
  WHERE i.status = 'lost'
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
$function$;

CREATE INDEX IF NOT EXISTS items_title_trgm ON public.items USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS items_description_trgm ON public.items USING gin (description gin_trgm_ops);
