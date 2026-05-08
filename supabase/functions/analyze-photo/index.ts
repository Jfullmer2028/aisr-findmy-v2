const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const { image_base64, mime_type } = await req.json();
    if (!image_base64) {
      return new Response(JSON.stringify({ error: "image_base64 required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY not set" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }

    // Remove data URL prefix if present
    let base64Data = image_base64;
    if (base64Data.includes(",")) {
      base64Data = base64Data.split(",")[1];
    }

    const prompt = `You are a helpful assistant that identifies lost items. Look at the photo and return a JSON object with exactly these keys: name (string, short title), category (one of: electronics, clothing, books, accessories, other), description (string, short, including color and distinctive features), location_guess (string or null). Respond ONLY with valid JSON, no extra text.`;

    // THE FIX: Using the correct modern model name
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mime_type || "image/jpeg",
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
          },
        }),
      }
    );

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error("Gemini API error:", errText);
      return new Response(JSON.stringify({ error: `Gemini API error: ${geminiResponse.status}`, detail: errText }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const visionData = await geminiResponse.json();
    const contentText = visionData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!contentText) throw new Error("No response from Gemini");

    // Robust JSON parsing
    let parsed;
    try {
      parsed = JSON.parse(contentText);
    } catch {
      const match = contentText.match(/\{.*\}/s);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error("Invalid JSON response");
    }
    return new Response(JSON.stringify(parsed), { headers: { ...cors, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});