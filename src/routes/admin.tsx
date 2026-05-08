import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({ component: Admin });

function Admin() {
  const { session, isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({ total: 0, pendingClaims: 0, claimedWeek: 0 });
  const [pendingItems, setPendingItems] = useState<any[]>([]);
  const [allItems, setAllItems] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);

  useEffect(() => { if (!loading && !isAdmin) navigate({ to: "/" }); }, [loading, isAdmin]);

  const load = async () => {
    const [{ count: total }, { count: pendingClaims }, { count: claimedWeek }] = await Promise.all([
      supabase.from("items").select("id", { count: "exact", head: true }),
      supabase.from("claims").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("items").select("id", { count: "exact", head: true }).eq("status", "claimed").gte("updated_at", new Date(Date.now() - 7 * 86400000).toISOString()),
    ]);
    setStats({ total: total ?? 0, pendingClaims: pendingClaims ?? 0, claimedWeek: claimedWeek ?? 0 });
    const { data: pi } = await supabase.from("items").select("*").eq("status", "pending").order("created_at", { ascending: false });
    const { data: ai } = await supabase.from("items").select("*").neq("status", "pending").order("created_at", { ascending: false }).limit(50);
    const { data: cl } = await supabase.from("claims").select("*, items(title)").order("created_at", { ascending: false }).limit(50);
    const { data: au } = await supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(50);
    setPendingItems(pi || []); setAllItems(ai || []); setClaims(cl || []); setAudit(au || []);
  };
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  const setItemStatus = async (id: number, status: string) => {
    const patch: any = { status };
    if (status === "claimed") patch.claimed_at = new Date().toISOString();
    await supabase.from("items").update(patch).eq("id", id);
    await supabase.from("audit_log").insert({ admin_id: session!.user.id, action: `set_${status}`, item_id: id });
    if (status === "lost") supabase.functions.invoke("embed-item", { body: { item_id: id } }).catch(() => {});
    toast.success("Updated"); load();
  };
  const extendClaim = async (id: number) => {
    await supabase.from("items").update({ claimed_at: new Date().toISOString() }).eq("id", id);
    await supabase.from("audit_log").insert({ admin_id: session!.user.id, action: "extend_claim", item_id: id });
    toast.success("Extended 7 days"); load();
  };
  const daysLeft = (claimedAt?: string | null) => {
    if (!claimedAt) return null;
    return Math.max(0, Math.ceil((new Date(claimedAt).getTime() + 7 * 86400000 - Date.now()) / 86400000));
  };
  const delItem = async (id: number) => {
    if (!confirm("Delete?")) return;
    await supabase.from("items").delete().eq("id", id);
    await supabase.from("audit_log").insert({ admin_id: session!.user.id, action: "delete_item", item_id: id });
    load();
  };
  const respondClaim = async (id: number, status: "approved" | "rejected" | "collected", response: string) => {
    await supabase.from("claims").update({ status, admin_response: response }).eq("id", id);
    toast.success("Claim updated"); load();
  };

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8 space-y-8">
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Total Items" value={stats.total} />
          <Stat label="Pending Claims" value={stats.pendingClaims} />
          <Stat label="Claimed (7d)" value={stats.claimedWeek} />
        </div>

        <Section title={`Pending Items (${pendingItems.length})`}>
          {pendingItems.map((it) => (
            <Card key={it.id} className="flex items-center gap-4 p-3">
              {it.photo_url && <img src={it.photo_url} className="h-14 w-14 rounded object-cover" />}
              <div className="flex-1">
                <Link to="/items/$id" params={{ id: String(it.id) }} className="font-semibold hover:underline">{it.title}</Link>
                <div className="text-xs text-muted-foreground">{it.location_found}</div>
              </div>
              <Button size="sm" onClick={() => setItemStatus(it.id, "lost")}>Approve</Button>
              <Button size="sm" variant="outline" onClick={() => setItemStatus(it.id, "rejected")}>Reject</Button>
              <Button size="sm" variant="destructive" onClick={() => delItem(it.id)}>Delete</Button>
            </Card>
          ))}
        </Section>

        <Section title="Manage Items">
          {allItems.map((it) => {
            const dl = daysLeft(it.claimed_at);
            return (
              <Card key={it.id} className="flex flex-wrap items-center gap-2 p-3">
                <Link to="/items/$id" params={{ id: String(it.id) }} className="flex-1 min-w-0 font-semibold hover:underline truncate">{it.title}</Link>
                <span className="rounded bg-secondary px-2 text-xs">{it.status}</span>
                {it.status === "claimed" && dl !== null && (
                  <span className="text-xs text-muted-foreground">{dl}d left</span>
                )}
                {it.status === "claimed" && (
                  <Button size="sm" variant="outline" onClick={() => extendClaim(it.id)}>Extend 7d</Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setItemStatus(it.id, "claimed")}>Claimed</Button>
                <Button size="sm" variant="outline" onClick={() => setItemStatus(it.id, "collected")}>Collected</Button>
                <Button size="sm" variant="destructive" onClick={() => delItem(it.id)}>Delete</Button>
              </Card>
            );
          })}
        </Section>

        <Section title="Manage Claims">
          {claims.map((c) => <ClaimRow key={c.id} c={c} respond={respondClaim} />)}
        </Section>

        <Section title="Audit Log">
          {audit.map((a) => (
            <div key={a.id} className="border-b py-2 text-sm">
              <span className="font-mono">{new Date(a.created_at).toLocaleString()}</span> — <b>{a.action}</b> item #{a.item_id}
            </div>
          ))}
        </Section>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <Card className="p-4"><div className="text-sm text-muted-foreground">{label}</div><div className="text-3xl font-bold">{value}</div></Card>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h2 className="text-xl font-bold">{title}</h2><div className="mt-3 space-y-2">{children}</div></section>;
}
function ClaimRow({ c, respond }: any) {
  const [resp, setResp] = useState("");
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">{c.items?.title || `Item #${c.item_id}`}</div>
          <div className="text-xs text-muted-foreground">By {c.claimant_name} · {c.claimant_contact} · <span className="rounded bg-secondary px-1">{c.status}</span></div>
          <div className="mt-1 text-sm">{c.description}</div>
          {c.proof_url && <a href={c.proof_url} target="_blank" rel="noreferrer" className="text-xs underline">Proof photo</a>}
        </div>
      </div>
      {c.status === "pending" && (
        <div className="mt-2 flex gap-2">
          <Input value={resp} onChange={(e) => setResp(e.target.value)} placeholder="Optional response" />
          <Button size="sm" onClick={() => respond(c.id, "approved", resp || "Approved")}>Approve</Button>
          <Button size="sm" variant="outline" onClick={() => respond(c.id, "rejected", resp || "Rejected")}>Reject</Button>
        </div>
      )}
      {c.status === "approved" && (
        <Button size="sm" className="mt-2" onClick={() => respond(c.id, "collected", "Collected")}>Mark collected</Button>
      )}
    </Card>
  );
}
