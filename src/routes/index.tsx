import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Navbar } from "@/components/Navbar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Search, Loader2, PackageSearch, Sparkles, MapPin } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import seal from "@/assets/aisr-seal.svg";

export const Route = createFileRoute("/")({ component: Home });

type Item = {
  id: number;
  title: string;
  description: string | null;
  category: string | null;
  location_found: string | null;
  photo_url: string | null;
  status: string;
  claimed_at?: string | null;
};

function daysLeft(claimedAt?: string | null): number | null {
  if (!claimedAt) return null;
  const ms = new Date(claimedAt).getTime() + 7 * 86400000 - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

function Home() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchMode, setSearchMode] = useState<string>("");

  const search = async (e?: React.FormEvent) => {
  e?.preventDefault();
  if (!q.trim()) return;
  setLoading(true);
  try {
    // Direct fetch with explicit anon key
    const response = await fetch(
      "https://uqvfbyhamlctugixpxxb.supabase.co/functions/v1/embed-search",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ query: q }),
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.results && data.results.length > 0) {
      setResults(data.results);
      setSearchMode(data.mode || "ai");
    } else {
      // Fallback to direct text search
      const { data: fallback, error: fallbackErr } = await supabase
        .from("items")
        .select("*")
        .ilike("title", `%${q}%`)
        .eq("status", "lost");
      if (fallbackErr) throw fallbackErr;
      setResults(fallback || []);
      setSearchMode("text-fallback");
    }
  } catch (err) {
    console.error("Search error:", err);
    toast.error("Search failed. Using manual mode?");
    setResults([]);
  } finally {
    setLoading(false);
  }
};

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-10 sm:py-16">
        <div className="text-center fade-in">
          <img src={seal} alt="AIS-R Seal" className="mx-auto h-16 w-16 sm:h-20 sm:w-20 drop-shadow-md" />
          <h1 className="mt-4 text-3xl sm:text-5xl font-bold text-primary tracking-tight">
            Lost something at AIS-R?
          </h1>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            Search the school's lost &amp; found — describe your item in plain words.
          </p>
        </div>

        <form onSubmit={search} className="mx-auto mt-8 sm:mt-10 flex max-w-2xl flex-col sm:flex-row gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. blue Hydroflask water bottle, AirPods Pro case…"
            className="h-12 text-base rounded-full px-5 shadow-sm focus-visible:ring-secondary"
          />
          <Button
            type="submit"
            size="lg"
            disabled={loading || !q.trim()}
            className="btn-gold h-12 rounded-full px-6 font-semibold"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span className="ml-2">Search</span>
          </Button>
        </form>

        {results === null && !loading && (
          <div className="mt-16 grid gap-4 sm:grid-cols-3 max-w-3xl mx-auto">
            {[
              { icon: Sparkles, title: "AI semantic search", desc: "Describe it however you remember it." },
              { icon: PackageSearch, title: "Updated daily", desc: "Items logged by staff and students." },
              { icon: MapPin, title: "Pickup at front office", desc: "Verify ownership to claim." },
            ].map(({ icon: Icon, title, desc }) => (
              <Card key={title} className="rounded-2xl p-5 text-center card-hover shadow-sm border-border/60">
                <Icon className="mx-auto h-7 w-7 text-secondary" />
                <div className="mt-3 font-semibold text-primary">{title}</div>
                <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
              </Card>
            ))}
          </div>
        )}

        {loading && (
          <div className="mt-16 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-secondary" />
            <p className="mt-2 text-sm text-muted-foreground">Searching...</p>
          </div>
        )}

        {results !== null && results.length === 0 && !loading && (
          <div className="mt-16 text-center fade-in">
            <PackageSearch className="mx-auto h-14 w-14 text-muted-foreground/40" />
            <p className="mt-4 font-medium text-primary">No matches yet</p>
            <p className="text-sm text-muted-foreground">Try different keywords, or check back tomorrow.</p>
          </div>
        )}

        {results && results.length > 0 && (
          <div className="fade-in">
            <p className="mt-10 text-xs uppercase tracking-wide text-muted-foreground">
              {results.length} result{results.length === 1 ? "" : "s"} · {searchMode === "direct-text" ? "text search" : "AI search"}
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((it) => (
                <Link key={it.id} to="/items/$id" params={{ id: String(it.id) }}>
                  <Card className="overflow-hidden rounded-2xl card-hover border-border/60 shadow-sm">
                    {it.photo_url ? (
                      <img src={it.photo_url} alt={it.title} className="h-44 w-full object-cover" />
                    ) : (
                      <div className="h-44 w-full bg-gradient-to-br from-primary/10 to-secondary/20 flex items-center justify-center">
                        <PackageSearch className="h-10 w-10 text-primary/30" />
                      </div>
                    )}
                    <div className="p-4">
                      <div className="font-semibold text-primary line-clamp-1">{it.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground line-clamp-1">
                        <MapPin className="inline h-3 w-3 mr-1" />
                        {it.location_found || "Location unknown"}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="inline-block rounded-full bg-secondary/90 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-secondary-foreground">
                          {it.status}
                        </span>
                        {it.status === "claimed" && daysLeft(it.claimed_at) !== null && (
                          <span className="text-[10px] font-medium text-muted-foreground">
                            {daysLeft(it.claimed_at)}d left
                          </span>
                        )}
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="mt-12 bg-primary text-primary-foreground/80">
        <div className="mx-auto max-w-5xl px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2">
            <img src={seal} alt="" className="h-6 w-6" />
            <span>American International School Riyadh</span>
          </div>
          <div className="text-xs opacity-70">© {new Date().getFullYear()} AIS-R Lost &amp; Found</div>
        </div>
      </footer>
    </div>
  );
}