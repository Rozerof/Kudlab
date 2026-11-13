import { describe, expect, it } from 'vitest';
import { allowedEmailDomains, emailDomainAllowed } from '../../src/modules/usuarios/shared/accounts.validation.js';

describe('ALLOWED_EMAIL_DOMAINS', () => {
  it('por defecto solo acepta correos que terminan en .edu.co', () => {
    expect(allowedEmailDomains(undefined)).toEqual(['.edu.co']);
    expect(emailDomainAllowed('docente@uptc.edu.co', allowedEmailDomains(''))).toBe(true);
    expect(emailDomainAllowed('docente@gmail.com', allowedEmailDomains(''))).toBe(false);
  });
  it('acepta sufijos, dominios exactos y comodín', () => {
    const d = allowedEmailDomains(' .edu.co , Gmail.com ');
    expect(emailDomainAllowed('a@uptc.edu.co', d)).toBe(true);
    expect(emailDomainAllowed('a@gmail.com', d)).toBe(true);
    expect(emailDomainAllowed('a@fakegmail.com', d)).toBe(false);
    expect(emailDomainAllowed('a@hotmail.com', d)).toBe(false);
    expect(emailDomainAllowed('a@hotmail.com', allowedEmailDomains('*'))).toBe(true);
  });
});
