import { z } from 'zod';

// Dominios permitidos: ALLOWED_EMAIL_DOMAINS, separados por coma. '.edu.co' = cualquier subdominio que termine así;
// 'gmail.com' = ese dominio exacto; '*' = cualquiera. Por defecto solo correos institucionales .edu.co.
export function allowedEmailDomains(source: string | undefined = process.env.ALLOWED_EMAIL_DOMAINS) {
  const list = (source ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : ['.edu.co'];
}
export function emailDomainAllowed(email: string, domains = allowedEmailDomains()) {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  return domains.some((d) => d === '*' || (d.startsWith('.') ? domain.endsWith(d) : domain === d));
}
export const institutionalEmail = z.email().transform((v) => v.trim().toLowerCase()).refine((v) => emailDomainAllowed(v), 'Dominio de correo no permitido');
export const nameSchema = z.string().trim().min(1).max(200);
export const createAccountSchema = z.strictObject({ name: nameSchema, email: institutionalEmail, role: z.literal('TEACHER') });
export const updateAccountSchema = z.strictObject({ name: nameSchema.optional(), email: institutionalEmail.optional() }).refine((x) => x.name !== undefined || x.email !== undefined);
export const passwordSchema = z.string().min(8).max(128).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/);
