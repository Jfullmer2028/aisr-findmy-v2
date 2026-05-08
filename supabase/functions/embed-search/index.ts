// Generates an embedding for a search query and returns matching items.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { query } = await req.json();
    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "query required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fuzzy/trigram fallback (typo-tolerant) restricted to lost
    const fuzzySearch = async () => {
      const { data, error } = await supabase.rpc("fuzzy_search_items", { q: query, match_count: 20 });
      if (error) throw error;
      return data ?? [];
    };

    // If no OpenAI key, only fallback
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ results: await fuzzySearch(), mode: "fts" }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2000);
      const embRes = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input: query, dimensions: 1536 }),
        signal: ctrl.signal,
      });
      clearTimeout(t);

      // Handle rate limit (429) specifically
      if (embRes.status === 429) {
        console.error("OpenAI rate limit hit, falling back to fuzzy search");
        return new Response(JSON.stringify({ results: await fuzzySearch(), mode: "rate-limit-fallback" }), { headers: { ...cors, "Content-Type": "application/json" } });
      }

      if (!embRes.ok) throw new Error(`OpenAI embedding failed: ${embRes.status}`);
      const emb = await embRes.json();
      const vector = emb.data?.[0]?.embedding;
      if (!vector) throw new Error("No embedding vector returned");

      // Semantic search with pgvector
      const { data, error } = await supabase.rpc("match_items", {
        query_embedding: vector,
        match_count: 20,
        similarity_threshold: 0.15,
      });
      if (error) throw error;

      if (!data || data.length === 0) {
        return new Response(JSON.stringify({ results: await fuzzySearch(), mode: "fuzzy-fallback" }), { headers: { ...cors, "Content-Type": "application/json" } });
      }

      // Merge with fuzzy results
      try {
        const fuzzy = await fuzzySearch();
        const seen = new Set(data.map((r: any) => r.id));
        for (const r of fuzzy) {
          if (!seen.has(r.id)) {
            data.push(r);
            seen.add(r.id);
          }
        }
      } catch (_) {}
      return new Response(JSON.stringify({ results: data, mode: "semantic+fuzzy" }), { headers: { ...cors, "Content-Type": "application/json" } });
    } catch (e) {
      console.error("Semantic search failed, falling back to fuzzy", e);
      return new Response(JSON.stringify({ results: await fuzzySearch(), mode: "fts-fallback" }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});