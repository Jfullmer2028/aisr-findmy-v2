// Generates an embedding for an item and stores it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { item_id } = await req.json();
    if (!item_id) return new Response(JSON.stringify({ error: "item_id required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return new Response(JSON.stringify({ ok: false, reason: "no key" }), { headers: { ...cors, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: item } = await supabase.from("items").select("id,title,description,category,location_found").eq("id", item_id).maybeSingle();
    if (!item) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });

    const text = [item.title, item.category, item.description, item.location_found].filter(Boolean).join(" \n ");
    const embRes = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text, dimensions: 1536 }),
    });
    if (!embRes.ok) return new Response(JSON.stringify({ ok: false, status: embRes.status }), { headers: { ...cors, "Content-Type": "application/json" } });
    const emb = await embRes.json();
    const vector = emb.data?.[0]?.embedding;
    await supabase.from("items").update({ embedding: vector }).eq("id", item_id);
    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
