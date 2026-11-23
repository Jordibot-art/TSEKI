/**
 * TSEKI Server-Side AI Proxy (Supabase Edge Function - Deno)
 *
 * Deploy with:
 *   supabase secrets set GEMINI_API_KEY=... GROQ_API_KEY=... OPENROUTER_API_KEY=...
 *   supabase functions deploy ai-proxy
 *
 * Security guarantees:
 * 1. Validates the caller's Supabase JWT before proxying any AI call.
 * 2. Enforces the 10/day per-teacher quota server-side via `public.check_ai_quota`.
 * 3. Keeps all system AI API keys strictly server-side (never bundled into APK or browser JS).
 */

// @ts-nocheck — Deno Edge Runtime file (excluded from Node/Expo tsc)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ProxyRequestBody {
  provider?: "gemini" | "groq" | "openrouter";
  model?: string;
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  jsonMode?: boolean;
  actionType?: "full_quiz" | "single_question" | "grading";
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonResponse({ error: "Server Supabase configuration incomplete." }, 503);
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing Bearer authorization token." }, 401);
    }

    // 1. Verify caller identity via Supabase Auth
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse({ error: "Invalid or expired session token." }, 401);
    }

    const teacherId = userData.user.id;
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // 2. Verify teacher approval status
    const { data: teacherRow } = await serviceClient
      .from("teachers")
      .select("status")
      .eq("user_id", teacherId)
      .maybeSingle();

    if (teacherRow && teacherRow.status && teacherRow.status !== "approved") {
      return jsonResponse(
        { error: `Account status is '${teacherRow.status}'. Administrator approval is required.` },
        403
      );
    }

    const payload = (await req.json()) as ProxyRequestBody;
    const prompt = String(payload?.prompt || "").trim();
    if (!prompt) {
      return jsonResponse({ error: "Prompt is required." }, 400);
    }

    const actionType = payload.actionType || "full_quiz";
    const cost = actionType === "full_quiz" ? 1 : 0;

    // 3. Enforce server-side AI quota before calling upstream models
    if (cost > 0) {
      const { data: quotaResult, error: quotaErr } = await serviceClient.rpc("check_ai_quota", {
        p_teacher_id: teacherId,
        p_cost: cost,
        p_daily_limit: 10,
      });

      if (!quotaErr && quotaResult && quotaResult.allowed === false) {
        return jsonResponse(
          {
            error: quotaResult.message || "Daily AI quota limit reached.",
            code: quotaResult.error_code || "QUOTA_EXCEEDED",
            quota: quotaResult,
          },
          429
        );
      }
    }

    // 4. Execute upstream provider call with automatic failover
    const provider = payload.provider || "gemini";
    let generatedText = "";
    let usedProvider = provider;

    const tryGemini = async () => {
      const key = Deno.env.get("GEMINI_API_KEY");
      if (!key) throw new Error("GEMINI_API_KEY not configured on proxy.");
      const model = payload.model || "gemini-2.5-flash";
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(payload.systemInstruction
              ? { systemInstruction: { parts: [{ text: payload.systemInstruction }] } }
              : {}),
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: payload.temperature ?? 0.3,
              ...(payload.jsonMode ? { responseMimeType: "application/json" } : {}),
            },
          }),
        }
      );
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (!text.trim()) throw new Error("Gemini returned empty response.");
      return text;
    };

    const tryGroq = async () => {
      const key = Deno.env.get("GROQ_API_KEY");
      if (!key) throw new Error("GROQ_API_KEY not configured on proxy.");
      const model = payload.model && provider === "groq" ? payload.model : "openai/gpt-oss-120b";
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          temperature: payload.temperature ?? 0.3,
          ...(payload.jsonMode ? { response_format: { type: "json_object" } } : {}),
          messages: [
            ...(payload.systemInstruction
              ? [{ role: "system", content: payload.systemInstruction }]
              : []),
            { role: "user", content: prompt },
          ],
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Groq HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || "";
      if (!text.trim()) throw new Error("Groq returned empty response.");
      return text;
    };

    const tryOpenRouter = async () => {
      const key = Deno.env.get("OPENROUTER_API_KEY");
      if (!key) throw new Error("OPENROUTER_API_KEY not configured on proxy.");
      const model =
        payload.model && provider === "openrouter" ? payload.model : "cohere/north-mini-code:free";
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "HTTP-Referer": "https://tseki.edu",
          "X-Title": "TSEKI AI Proxy",
        },
        body: JSON.stringify({
          model,
          temperature: payload.temperature ?? 0.3,
          messages: [
            ...(payload.systemInstruction
              ? [{ role: "system", content: payload.systemInstruction }]
              : []),
            { role: "user", content: prompt },
          ],
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenRouter HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || "";
      if (!text.trim()) throw new Error("OpenRouter returned empty response.");
      return text;
    };

    const order: Array<{ name: "gemini" | "groq" | "openrouter"; fn: () => Promise<string> }> =
      provider === "groq"
        ? [
            { name: "groq", fn: tryGroq },
            { name: "openrouter", fn: tryOpenRouter },
            { name: "gemini", fn: tryGemini },
          ]
        : provider === "openrouter"
        ? [
            { name: "openrouter", fn: tryOpenRouter },
            { name: "groq", fn: tryGroq },
            { name: "gemini", fn: tryGemini },
          ]
        : [
            { name: "gemini", fn: tryGemini },
            { name: "groq", fn: tryGroq },
            { name: "openrouter", fn: tryOpenRouter },
          ];

    const errors: string[] = [];
    for (const candidate of order) {
      try {
        generatedText = await candidate.fn();
        usedProvider = candidate.name;
        break;
      } catch (err) {
        errors.push(`${candidate.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!generatedText) {
      await serviceClient.from("ai_generation_logs").insert({
        teacher_id: teacherId,
        action_type: actionType === "single_question" ? "single_question" : "full_quiz",
        cost: 0,
        status: "failed",
        error_message: errors.join(" | ").slice(0, 500),
      });
      return jsonResponse(
        { error: "All AI providers failed.", details: errors },
        502
      );
    }

    // 5. Record successful quota consumption server-side
    if (cost > 0) {
      await serviceClient.rpc("record_ai_generation_success", {
        p_teacher_id: teacherId,
        p_action_type: "full_quiz",
        p_cost: cost,
      });
    }

    return jsonResponse({ text: generatedText, provider: usedProvider }, 200);
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unexpected AI proxy error." },
      500
    );
  }
});
