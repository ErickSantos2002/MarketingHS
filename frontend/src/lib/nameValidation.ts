export type NameValidationResult = { valid: boolean; reason?: string };

const ALLOWED_CHARS = /^[A-Za-zÀ-ÖØ-öø-ÿ'\-\s.]+$/;

export function validateFullName(value: string): NameValidationResult {
  const trimmed = (value || "").trim();

  if (trimmed.length < 3) {
    return { valid: false, reason: "Digite seu nome completo (nome e sobrenome)" };
  }
  if (trimmed.length > 100) {
    return { valid: false, reason: "Nome muito longo (máx. 100 caracteres)" };
  }
  if (/\d/.test(trimmed)) {
    return { valid: false, reason: "O nome não pode conter números" };
  }
  if (/@/.test(trimmed)) {
    return { valid: false, reason: "O nome não pode conter @ (use o campo de e-mail)" };
  }
  const lower = trimmed.toLowerCase();
  if (/(https?:\/\/|www\.|\.com|\.br|\.net|\.org)/.test(lower)) {
    return { valid: false, reason: "O nome não pode conter links ou domínios" };
  }
  if (!ALLOWED_CHARS.test(trimmed)) {
    return { valid: false, reason: "O nome contém caracteres inválidos" };
  }
  const words = trimmed.split(/\s+/).filter((w) => w.replace(/[.'\-]/g, "").length >= 2);
  if (words.length < 2) {
    return { valid: false, reason: "Digite seu nome completo (nome e sobrenome)" };
  }
  return { valid: true };
}
