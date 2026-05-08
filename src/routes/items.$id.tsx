import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreVertical, Clock } from "lucide-react";

export const Route = createFileRoute("/items/$id")({ component: ItemDetail });

function daysRemaining(claimedAt: string | null): number | null {
  if (!claimedAt) return null;
  const ms = new Date(claimedAt).getTime() + 7 * 86400000 - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

function ItemDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { session, isAdmin } = useAuth();
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("items").select("*").eq("id", Number(id)).maybeSingle();
    setItem(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const claimItem = async () => {
    if (!session?.user || !item) return;
    setClaiming(true);
    try {
      const { error } = await supabase
        .from("items")
        .update({ status: "claimed", claimed_at: new Date().toISOString() })
        .eq("id", item.id);
      if (error) throw error;
      // Optional record in claims table (best-effort, ignore failures)
      supabase.from("claims").insert({
        item_id: item.id,
        claimant_id: session.user.id,
        status: "approved",
      }).then(() => {});
      toast.success(`Item claimed. Pick it up at ${item.location_found || "the front office"}. You have 7 days to collect.`, { duration: 8000 });
      load();
    } catch (e: any) {
      toast.error(e.message || "Failed to claim");
    } finally { setClaiming(false); }
  };

  const adminAction = async (action: "claimed" | "collected" | "lost" | "delete" | "extend") => {
    if (!item) return;
    if (action === "delete") {
      if (!confirm("Delete this item?")) return;
      await supabase.from("items").delete().eq("id", item.id);
      await supabase.from("audit_log").insert({ admin_id: session!.user.id, action: "delete_item", item_id: item.id });
      toast.success("Deleted");
      navigate({ to: "/admin" });
      return;
    }
    if (action === "extend") {
      await supabase.from("items").update({ claimed_at: new Date().toISOString() }).eq("id", item.id);
      await supabase.from("audit_log").insert({ admin_id: session!.user.id, action: "extend_claim", item_id: item.id });
      toast.success("Extended by 7 days");
      load();
      return;
    }
    const patch: any = { status: action };
    if (action === "claimed") patch.claimed_at = new Date().toISOString();
    await supabase.from("items").update(patch).eq("id", item.id);
    await supabase.from("audit_log").insert({ admin_id: session!.user.id, action: `mark_${action}`, item_id: item.id });
    toast.success("Updated");
    load();
  };

  const days = item ? daysRemaining(item.claimed_at) : null;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-8">
        {loading ? <p>Loading…</p> : !item ? (
          <p>Item not found. <Link to="/" className="underline">Go back</Link></p>
        ) : (
          <Card className="overflow-hidden rounded-2xl shadow-sm">
            {item.photo_url && <img src={item.photo_url} alt={item.title} className="max-h-96 w-full object-cover" />}
            <div className="p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-bold text-primary">{item.title}</h1>
                  <div className="mt-1 inline-block rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold uppercase text-secondary-foreground">{item.status}</div>
                </div>
                {isAdmin && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="outline" size="icon"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => adminAction("lost")}>Mark Lost</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => adminAction("claimed")}>Mark Claimed</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => adminAction("collected")}>Mark Collected</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => adminAction("extend")}>Extend 7 days</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => adminAction("delete")} className="text-destructive">Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <p className="mt-4 text-foreground">{item.description}</p>
              <p className="mt-2 text-sm text-muted-foreground">📍 {item.location_found || "Unknown location"}</p>
              {item.category && <p className="text-sm text-muted-foreground">Category: {item.category}</p>}

              {item.status === "claimed" && days !== null && (
                <div className="mt-5 flex items-center gap-2 rounded-xl bg-secondary/15 px-4 py-3 text-sm text-primary">
                  <Clock className="h-4 w-4" />
                  <span>
                    {days > 0
                      ? <>Claimed — <b>{days} day{days === 1 ? "" : "s"}</b> left to collect at <b>{item.location_found || "the front office"}</b>.</>
                      : <>Pickup window expired.</>}
                  </span>
                </div>
              )}

              {session && item.status === "lost" && (
                <Button
                  className="btn-gold mt-6 h-12 w-full sm:w-auto rounded-full px-8 font-semibold"
                  onClick={claimItem}
                  disabled={claiming}
                >
                  {claiming ? "Claiming…" : "Claim This Item"}
                </Button>
              )}

              {!session && <p className="mt-6 text-sm text-muted-foreground">Sign in to claim this item.</p>}
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
