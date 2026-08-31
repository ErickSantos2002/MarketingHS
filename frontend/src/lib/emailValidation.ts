import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { isDisposableDomain } from "./disposableEmailDomains";

const emailSchema = z.string().trim().toLowerCase().email();

export type EmailCheckResult = {
  valid: boolean;
  reason?: string;
};

export function validateEmailFormat(email: string): EmailCheckResult {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return { valid: false, reason: "Formato de email inválido." };
  }
  if (isDisposableDomain(parsed.data)) {
    return { valid: false, reason: "Use um email corporativo ou pessoal real." };
  }
  return { valid: true };
}

// Cache em memória do client por sessão
const mxCache = new Map<string, { result: EmailCheckResult; expiresAt: number }>();
const MX_CACHE_TTL_MS = 60 * 60 * 1000; // 1h

export async function checkEmailDomainMX(email: string): Promise<EmailCheckResult> {
  const fmt = validateEmailFormat(email);
  if (!fmt.valid) return fmt;

  const domain = email.toLowerCase().trim().split("@")[1];
  const cached = mxCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const { data, error } = await supabase.functions.invoke("validate-email-domain", {
      body: { email },
    });
    clearTimeout(timeoutId);

    if (error) {
      // Falha graceful: não bloqueia conversão por falha de infra
      console.warn("[emailValidation] MX check failed, accepting:", error);
      return { valid: true };
    }

    const result: EmailCheckResult = {
      valid: !!data?.valid,
      reason: data?.reason,
    };
    mxCache.set(domain, { result, expiresAt: Date.now() + MX_CACHE_TTL_MS });
    return result;
  } catch (err) {
    console.warn("[emailValidation] MX check error, accepting:", err);
    return { valid: true };
  }
}
