import { supabase } from "@/lib/supabase";

export async function uploadPhoto(bucket: "items" | "proofs", file: File, userId: string) {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${userId}/${Date.now()}.${ext}`;
  
  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: false,
    contentType: file.type,
  });
  if (uploadError) throw uploadError;

  // Get the public URL (works only if bucket is public)
  const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(path);
  const publicUrl = publicUrlData.publicUrl;
  
  // Debug: log the URL to console (remove in production)
  console.log("Uploaded photo public URL:", publicUrl);
  
  return publicUrl;
}