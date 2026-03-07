/**
 * Supabase Edge Function: submit-application
 *
 * Receives the loan application payload from the browser, upserts it into
 * the Supabase `applications` table, then forwards key contact/loan fields
 * to the GHL webhook so a contact/lead is created in the CRM.
 *
 * Called from the browser at:
 *   https://gxwwcrcllhaaoewgcbeo.supabase.co/functions/v1/submit-application
 */

// These env vars are automatically injected in Supabase Edge Functions — no manual secrets needed
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://gxwwcrcllhaaoewgcbeo.supabase.co";
const SUPABASE_SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const GHL_WEBHOOK_URL =
  Deno.env.get("GHL_APP_WEBHOOK_URL") ??
  "https://services.leadconnectorhq.com/hooks/jlep72SieYHunxGEJWrI/webhook-trigger/9540405a-8276-4540-b43c-ef1a8c9487a7";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
  }

  let app: Record<string, unknown>;
  try {
    app = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  console.log("Application received:", app.id);

  // --- 1. Upsert into Supabase applications table ---
  let supabaseOk = false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/applications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(app),
    });
    supabaseOk = res.ok || res.status === 409;
    if (!res.ok && res.status !== 409) {
      const err = await res.text();
      console.warn("Supabase upsert failed:", res.status, err);
    } else {
      console.log("Supabase upsert OK, status:", res.status);
    }
  } catch (err) {
    console.error("Supabase fetch error:", err);
  }

  // --- 2. Forward to GHL CRM webhook ---
  const a1 = (app.a1 ?? {}) as Record<string, string>;
  const biz = (app.biz ?? {}) as Record<string, string>;

  const firstName = a1.firstName ?? "";
  const lastName  = a1.lastName  ?? "";

  // Build a readable loan summary for GHL notes field
  const loanSummary = [
    app.purpose   ? `Purpose: ${String(app.purpose).charAt(0).toUpperCase() + String(app.purpose).slice(1)}` : "",
    app.fin_type  ? `Finance type: ${app.fin_type}` : "",
    app.finType   ? `Finance type: ${app.finType}` : "",
    app.loan_amount || app.loanAmount ? `Loan amount: ${app.loan_amount ?? app.loanAmount}` : "",
    app.loan_duration || app.loanDuration ? `Duration: ${app.loan_duration ?? app.loanDuration} years` : "",
    app.make  ? `Asset: ${[app.year, app.make, app.model].filter(Boolean).join(" ")}` : "",
    a1.empStatus  ? `Employment: ${a1.empStatus}` : "",
    biz.name      ? `Business: ${biz.name}` : "",
    biz.abn       ? `ABN: ${biz.abn}` : "",
  ].filter(Boolean).join(" | ");

  const ghlPayload = {
    // Standard GHL contact fields (both formats for compatibility)
    firstName,
    lastName,
    first_name: firstName,
    last_name: lastName,
    name: [firstName, lastName].filter(Boolean).join(" "),
    email: a1.email ?? "",
    phone: a1.mobile ?? "",

    // Address
    address1: a1.street ?? "",
    city: a1.suburb ?? "",
    state: a1.state ?? "",
    postalCode: a1.postcode ?? "",
    country: "AU",

    // Loan details as custom fields
    application_id: app.id ?? app.app_id ?? "",
    loan_purpose: app.purpose ?? "",
    finance_type: app.finType ?? app.fin_type ?? "",
    loan_amount: app.loanAmount ?? app.loan_amount ?? "",
    loan_duration: app.loanDuration ?? app.loan_duration ?? "",
    asset_make: app.make ?? "",
    asset_model: app.model ?? "",
    asset_year: app.year ?? "",
    asset_condition: app.condition ?? "",
    employment_status: a1.empStatus ?? "",
    employer: a1.empName ?? "",
    occupation: a1.occupation ?? "",
    income: a1.income ?? "",
    // Business fields
    business_name: biz.name ?? "",
    business_abn: biz.abn ?? "",
    business_industry: biz.industry ?? "",

    // Summary note
    notes: loanSummary,
    source: "JLP Loan Application",
    submitted_at: app.submittedAt ?? new Date().toISOString(),
    tags: ["Loan Application", String(app.purpose ?? "").charAt(0).toUpperCase() + String(app.purpose ?? "").slice(1)].filter(Boolean),
  };

  let ghlOk = false;
  try {
    const ghlRes = await fetch(GHL_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ghlPayload),
    });
    ghlOk = ghlRes.ok;
    const ghlBody = await ghlRes.text();
    console.log("GHL webhook response:", ghlRes.status, ghlBody);
  } catch (err) {
    console.error("GHL webhook error:", err);
  }

  return new Response(
    JSON.stringify({ ok: true, supabase: supabaseOk, ghl: ghlOk }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
  );
});
