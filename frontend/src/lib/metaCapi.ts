import { supabase } from "@/integrations/supabase/client";

// Helper to get Facebook cookies
function getFbCookies() {
  const cookies = document.cookie.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    acc[key] = value;
    return acc;
  }, {} as Record<string, string>);

  return {
    fbc: cookies['_fbc'] || null,
    fbp: cookies['_fbp'] || null,
  };
}

// Helper to get client info
function getClientInfo() {
  return {
    client_user_agent: navigator.userAgent,
    event_source_url: window.location.href,
  };
}

interface MetaCapiEventData {
  event_name?: string;
  event_id?: string;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  external_id?: string;
  custom_data?: Record<string, any>;
}

/**
 * Send a conversion event to Meta Conversions API via Edge Function
 * 
 * @param eventData - The event data to send
 * @returns Promise with the result
 * 
 * @example
 * // Send a Lead event when form is submitted
 * await sendMetaConversion({
 *   event_name: 'Lead',
 *   email: 'user@example.com',
 *   phone: '11999999999',
 *   first_name: 'João',
 *   custom_data: {
 *     lead_type: 'gratuito',
 *     source: 'landing-page'
 *   }
 * });
 */
export async function sendMetaConversion(eventData: MetaCapiEventData) {
  try {
    const { fbc, fbp } = getFbCookies();
    const { client_user_agent, event_source_url } = getClientInfo();

    const payload = {
      ...eventData,
      fbc,
      fbp,
      client_user_agent,
      event_source_url,
    };

    console.log('[Meta CAPI] Sending conversion:', payload);

    const { data, error } = await supabase.functions.invoke('send-to-meta-capi', {
      body: payload,
    });

    if (error) {
      console.error('[Meta CAPI] Error:', error);
      return { success: false, error };
    }

    console.log('[Meta CAPI] Success:', data);
    return { success: true, data };
  } catch (error) {
    console.error('[Meta CAPI] Exception:', error);
    return { success: false, error };
  }
}

/**
 * Convenience function to track a Lead event
 */
export async function trackMetaLead(userData: {
  email: string;
  phone?: string;
  first_name?: string;
  custom_data?: Record<string, any>;
}) {
  return sendMetaConversion({
    event_name: 'Lead',
    ...userData,
  });
}

/**
 * Convenience function to track a Purchase event
 */
export async function trackMetaPurchase(userData: {
  email: string;
  phone?: string;
  first_name?: string;
  custom_data?: Record<string, any>;
}) {
  return sendMetaConversion({
    event_name: 'Purchase',
    ...userData,
  });
}

/**
 * Convenience function to track InitiateCheckout event
 */
export async function trackMetaInitiateCheckout(userData: {
  email: string;
  phone?: string;
  first_name?: string;
  custom_data?: Record<string, any>;
}) {
  return sendMetaConversion({
    event_name: 'InitiateCheckout',
    ...userData,
  });
}
