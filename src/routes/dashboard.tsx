import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard")({ component: Dashboard });

function Dashboard() {
  const { session } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);

  const load = async () => {
    if (!session?.user) return;
    const { data: i } = await supabase.from("items").select("*").eq("submitted_by", session.user.id).order("created_at", { ascending: false });
    const { data: c } = await supabase.from("claims").select("*, items(title)").eq("claimant_id", session.user.id).order("created_at", { ascending: false });
    setItems(i || []); setClaims(c || []);
  };
  useEffect(() => { load(); }, [session?.user.id]);

  const del = async (id: number) => {
    if (!confirm("Delete?")) return;
    const { error } = await supabase.from("items").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted"); load();
  };

  if (!session) return <div className="min-h-screen bg-background"><Navbar /><p className="p-8">Please sign in.</p></div>;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 py-8 space-y-8">
        <section>
          <h2 className="text-xl font-bold">My Reports</h2>
          {items.length === 0 ? <p className="mt-2 text-muted-foreground">No reports yet. <Link to="/report" className="underline">Report one</Link>.</p> :
            <div className="mt-3 space-y-2">
              {items.map((it) => (
                <Card key={it.id} className="flex items-center justify-between p-3">
                  <div>
                    <Link to="/items/$id" params={{ id: String(it.id) }} className="font-semibold hover:underline">{it.title}</Link>
                    <div className="text-xs text-muted-foreground">{it.location_found} · <span className="rounded bg-secondary px-1">{it.status}</span></div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => del(it.id)}>Delete</Button>
                </Card>
              ))}
            </div>
          }
        </section>
        <section>
          <h2 className="text-xl font-bold">My Claims</h2>
          {claims.length === 0 ? <p className="mt-2 text-muted-foreground">No claims yet.</p> :
            <div className="mt-3 space-y-2">
              {claims.map((c) => (
                <Card key={c.id} className="p-3">
                  <div className="font-semibold">{c.items?.title || `Item #${c.item_id}`}</div>
                  <div className="text-xs text-muted-foreground">Status: <span className="rounded bg-secondary px-1">{c.status}</span></div>
                  {c.admin_response && <div className="mt-1 text-sm">Admin: {c.admin_response}</div>}
                </Card>
              ))}
            </div>
          }
        </section>
      </main>
    </div>
  );
}
