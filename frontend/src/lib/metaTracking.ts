import { sendMetaConversion } from "./metaCapi";

function newEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function fbqTrack(
  type: "track" | "trackCustom",
  eventName: string,
  params: Record<string, any>,
  eventId: string
) {
  if (typeof window === "undefined") return;
  const fbq = (window as any).fbq;
  if (typeof fbq !== "function") return;
  try {
    fbq(type, eventName, params, { eventID: eventId });
    console.log(`[Meta Pixel] ${eventName} fired with eventID:`, eventId);
  } catch (e) {
    console.error(`[Meta Pixel] Error firing ${eventName}:`, e);
  }
}

/**
 * Track a CTA click intent. Custom event 'ClickCTA' (no PII).
 */
export function trackCtaClick(location: string, extra: Record<string, any> = {}) {
  const event_id = newEventId();
  const page = typeof window !== "undefined" ? window.location.pathname : "";
  const custom_data = { cta_location: location, page, ...extra };

  // Pixel-only: ClickCTA has no PII, so CAPI would be rejected by Meta
  // (error_subcode 2804050 — insufficient customer parameters).
  // The browser Pixel still carries fbp/fbc/ip/user_agent automatically.
  fbqTrack("trackCustom", "ClickCTA", custom_data, event_id);
}

interface LeadUserData {
  email: string;
  phone?: string;
  first_name?: string;
  custom_data?: Record<string, any>;
}

/**
 * Track standard Meta 'Lead' event with PII. Deduplicated Pixel + CAPI.
 */
export function trackLeadDedup({ email, phone, first_name, custom_data = {} }: LeadUserData) {
  const event_id = newEventId();

  fbqTrack(
    "track",
    "Lead",
    { email, phone, first_name, ...custom_data },
    event_id
  );

  sendMetaConversion({
    event_name: "Lead",
    event_id,
    email,
    phone,
    first_name,
    custom_data,
  });
}

/**
 * Track standard Meta 'CompleteRegistration' event. Deduplicated Pixel + CAPI.
 */
export function trackCompleteRegistration({
  email,
  phone,
  first_name,
  custom_data = {},
}: LeadUserData) {
  const event_id = newEventId();

  fbqTrack(
    "track",
    "CompleteRegistration",
    { email, phone, first_name, ...custom_data },
    event_id
  );

  sendMetaConversion({
    event_name: "CompleteRegistration",
    event_id,
    email,
    phone,
    first_name,
    custom_data,
  });
}
