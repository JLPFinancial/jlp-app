/**
 * Supabase Edge Function: consent-complete
 *
 * Receives the sendlink.co completion webhook when a privacy consent
 * form is signed, then forwards the event to a GHL workflow webhook
 * so the document is stored on the contact in GHL.
 *
 * Webhook URL (set this in sendlink):
 *   https://gxwwcrcllhaaoewgcbeo.supabase.co/functions/v1/consent-complete
 *
 * Required env vars (set via: supabase secrets set KEY=value):
 *   GHL_CONSENT_WEBHOOK_URL  - GHL Workflow "Inbound Webhook" trigger URL
 *                              (create a new Workflow in GHL → Trigger: Inbound Webhook)
 */

const GHL_CONSENT_WEBHOOK_URL =
  Deno.env.get("GHL_CONSENT_WEBHOOK_URL") ??
  "https://services.leadconnectorhq.com/hooks/jlep72SieYHunxGEJWrI/webhook-trigger/9697d49f-5d0e-409b-932a-ba10699435aa";

Deno.serve(async (req: Request) => {
  // Health check
  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  console.log("sendlink webhook received:", JSON.stringify(body));

  // sendlink payload shape (fields may vary — we handle common variations)
  const signers: Array<Record<string, string>> =
    (body.signers as Array<Record<string, string>>) ??
    (body.recipients as Array<Record<string, string>>) ??
    [];

  const primarySigner = signers[0] ?? {};

  const email: string =
    (primarySigner.email as string) ??
    (body.email as string) ??
    "";

  const name: string =
    (primarySigner.name as string) ??
    (body.signer_name as string) ??
    "";

  // The completed/signed PDF URL
  const documentUrl: string =
    (body.signed_pdf_url as string) ??
    (body.document_url as string) ??
    (body.download_url as string) ??
    "";

  const documentId: string =
    (body.document_id as string) ??
    (body.id as string) ??
    "";

  const completedAt: string =
    (body.completed_at as string) ??
    (body.signed_at as string) ??
    new Date().toISOString();

  if (!email) {
    console.warn("No email found in sendlink payload:", JSON.stringify(body));
    // Still return 200 so sendlink doesn't retry indefinitely
    return new Response(
      JSON.stringify({ ok: false, reason: "no_email_in_payload" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Forward to GHL workflow so it can find the contact and attach the document
  const ghlPayload = {
    event: "consent_form.completed",
    email,
    name,
    document_id: documentId,
    document_url: documentUrl,
    completed_at: completedAt,
    source: "JLP Loan Application – Privacy Consent",
  };

  if (!GHL_CONSENT_WEBHOOK_URL) {
    console.error("GHL_CONSENT_WEBHOOK_URL env var is not set");
    return new Response(
      JSON.stringify({ ok: false, reason: "ghl_webhook_not_configured" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  let ghlOk = false;
  try {
    const ghlRes = await fetch(GHL_CONSENT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ghlPayload),
    });
    ghlOk = ghlRes.ok;
    console.log("GHL webhook response:", ghlRes.status);
  } catch (err) {
    console.error("Failed to call GHL webhook:", err);
  }

  return new Response(
    JSON.stringify({ ok: true, ghl_notified: ghlOk }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
