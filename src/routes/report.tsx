import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { uploadPhoto } from "@/lib/upload";
import { toast } from "sonner";
import { Sparkles, Loader2, Camera } from "lucide-react";

export const Route = createFileRoute("/report")({ component: Report });

function Report() {
  const { session, isAdmin } = useAuth();
  const navigate = useNavigate();

  // Manual mode state
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("other");
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // AI mode state
  const [aiPhase, setAiPhase] = useState<"idle" | "uploading" | "analyzing" | "submitting" | "review">("idle");
  const [aiPhotoUrl, setAiPhotoUrl] = useState<string | null>(null);
  const [aiData, setAiData] = useState<{ name: string; category: string; description: string; location_guess: string } | null>(null);
  const [aiLocation, setAiLocation] = useState("");

  if (!session) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="mx-auto max-w-md px-4 py-16 text-center">
          <p>Please sign in to report an item.</p>
        </main>
      </div>
    );
  }

  const checkRateLimit = async () => {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await supabase.from("items").select("id", { count: "exact", head: true }).eq("submitted_by", session.user.id).gte("created_at", since);
    return (count ?? 0) < 5;
  };

  const callAnalyzePhoto = async (file: File) => {
    if (!(file instanceof Blob)) {
      throw new Error("Invalid file provided");
    }

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(
        "https://uqvfbyhamlctugixpxxb.supabase.co/functions/v1/analyze-photo",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ image_base64: base64, mime_type: file.type }),
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      console.error("callAnalyzePhoto error:", err);
      throw new Error(err.message || "Request failed or timed out");
    }
  };

  const onAiPhoto = async (f: File | null) => {
    if (!f) return;
    if (!(await checkRateLimit())) return toast.error("Rate limit: 5 reports per day");
    setAiPhase("uploading");
    try {
      const url = await uploadPhoto("items", f, session.user.id);
      setAiPhotoUrl(url);
      setAiPhase("analyzing");
      const data = await callAnalyzePhoto(f);
      setAiData(data);
      setAiLocation(data.location_guess || "");
      setAiPhase("review");
    } catch (e: any) {
      console.error("AI analysis error:", e);
      toast.error("AI analysis failed: " + e.message + " — using Manual mode.");
      setAiPhase("idle");
      setAiPhotoUrl(null);
    }
  };

  const aiConfirmSubmit = async () => {
    if (!aiData || !aiPhotoUrl) return;
    setAiPhase("submitting");
    try {
      const status = isAdmin ? "lost" : "pending";
      const { data, error } = await supabase.rpc("insert_item", {
        item_title: aiData.name,
        item_description: aiData.description,
        item_category: aiData.category,
        item_location: aiLocation,
        item_photo_url: aiPhotoUrl,
        item_status: status,
      });
      if (error) throw error;
      const itemId = data?.id;
      if (itemId) {
        supabase.functions.invoke("embed-item", { body: { item_id: itemId } }).catch(() => {});
      }
      toast.success(isAdmin ? "Item published" : "Submitted for admin review");
      navigate({ to: "/dashboard" });
    } catch (e: any) {
      toast.error(e.message || "Failed");
      setAiPhase("review");
    }
  };

  const onPhoto = (f: File | null) => {
    setPhoto(f);
    setPhotoPreview(f ? URL.createObjectURL(f) : null);
  };

  const submitManual = async () => {
    if (!title.trim()) return toast.error("Title required");
    if (!photo) return toast.error("Photo required");
    if (!(await checkRateLimit())) return toast.error("Rate limit: 5 reports per day");
    setSubmitting(true);
    try {
      const photoUrl = await uploadPhoto("items", photo, session.user.id);
      const status = isAdmin ? "lost" : "pending";
      const { data, error } = await supabase.rpc("insert_item", {
        item_title: title,
        item_description: description,
        item_category: category,
        item_location: location,
        item_photo_url: photoUrl,
        item_status: status,
      });
      if (error) throw error;
      const itemId = data?.id;
      if (itemId) {
        supabase.functions.invoke("embed-item", { body: { item_id: itemId } }).catch(() => {});
      }
      toast.success(isAdmin ? "Item published" : "Submitted for admin review");
      navigate({ to: "/dashboard" });
    } catch (e: any) {
      toast.error(e.message || "Failed");
    } finally { setSubmitting(false); }
  };

  const phaseLabel = {
    uploading: "Uploading photo…",
    analyzing: "AI is identifying your item…",
    submitting: "Submitting…",
  }[aiPhase as "uploading" | "analyzing" | "submitting"] || "";

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-bold text-primary">Report a found item</h1>
        <Tabs defaultValue="ai" className="mt-6">
          <TabsList className="w-full grid grid-cols-2 h-12">
            <TabsTrigger value="ai" className="h-10"><Sparkles className="mr-2 h-4 w-4" />AI Mode</TabsTrigger>
            <TabsTrigger value="manual" className="h-10">Manual</TabsTrigger>
          </TabsList>

          <TabsContent value="ai">
            <Card className="p-6 space-y-4 rounded-2xl shadow-sm">
              {aiPhase === "idle" && (
                <>
                  <Label className="text-base">Take or upload a photo</Label>
                  <p className="text-sm text-muted-foreground">AI will identify the item and submit automatically. You can adjust the location.</p>
                  <label className="block">
                    <div className="flex items-center justify-center gap-2 h-14 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 transition cursor-pointer text-primary font-medium">
                      <Camera className="h-5 w-5" />
                      <span>Tap to capture or upload</span>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => onAiPhoto(e.target.files?.[0] || null)}
                    />
                  </label>
                </>
              )}

              {(aiPhase === "uploading" || aiPhase === "analyzing" || aiPhase === "submitting") && (
                <div className="py-12 flex flex-col items-center gap-4 text-center">
                  {aiPhotoUrl && <img src={aiPhotoUrl} alt="" className="max-h-48 rounded-xl shadow" />}
                  <Loader2 className="h-10 w-10 animate-spin text-secondary" />
                  <p className="font-medium text-primary">{phaseLabel}</p>
                </div>
              )}

              {aiPhase === "review" && aiData && (
                <div className="space-y-4">
                  {aiPhotoUrl && <img src={aiPhotoUrl} alt={aiData.name} className="w-full max-h-64 object-cover rounded-xl shadow" />}
                  <div className="rounded-xl bg-secondary/10 p-4 space-y-1">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">AI identified</div>
                    <div className="text-lg font-semibold text-primary">{aiData.name}</div>
                    <div className="text-sm text-muted-foreground">{aiData.description}</div>
                    <div className="text-xs text-muted-foreground capitalize">Category: {aiData.category}</div>
                  </div>
                  <div>
                    <Label>Where did you find it? *</Label>
                    <Input
                      value={aiLocation}
                      onChange={(e) => setAiLocation(e.target.value)}
                      placeholder="e.g. Library, Cafeteria, Gym locker room"
                      className="h-12 rounded-xl"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={aiConfirmSubmit} disabled={!aiLocation.trim()} className="btn-gold flex-1 h-12 rounded-xl">
                      Submit
                    </Button>
                    <Button variant="outline" onClick={() => { setAiPhase("idle"); setAiPhotoUrl(null); setAiData(null); }} className="h-12 rounded-xl">
                      Retake
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="manual">
            <Card className="p-6 space-y-4 rounded-2xl shadow-sm">
              <div>
                <Label>Photo of item</Label>
                <Input type="file" accept="image/*" capture="environment" onChange={(e) => onPhoto(e.target.files?.[0] || null)} className="h-12" />
              </div>
              {photoPreview && <img src={photoPreview} alt="preview" className="max-h-64 rounded-xl" />}
              <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-12 rounded-xl" /></div>
              <div><Label>Category</Label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full h-12 rounded-xl border bg-background p-2">
                  <option value="electronics">Electronics</option>
                  <option value="clothing">Clothing</option>
                  <option value="books">Books</option>
                  <option value="accessories">Accessories</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div><Label>Location found</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} className="h-12 rounded-xl" /></div>
              <div><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-xl" /></div>
              <Button onClick={submitManual} disabled={submitting} className="btn-gold w-full h-12 rounded-xl">
                {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</> : "Submit"}
              </Button>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}