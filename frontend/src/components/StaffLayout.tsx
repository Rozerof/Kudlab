import type { ReactNode } from 'react';
import fondo from '@/assets/fotos/lectura.webp';

// Fotografía de fondo: Gustavo Fring, Pexels 5621973 (licencia libre de Pexels).
export function StaffLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  if (wide) return <div className="auth-page workspace-page"><main id="contenido" className="staff-main">{children}</main></div>;
  return <div className="auth-page auth-hero-page">
    <div className="auth-backdrop" aria-hidden="true" style={{ backgroundImage: `url(${fondo})` }} />
    <header className="auth-header">
      <div className="auth-header-inner">
        <p className="auth-brand">Kudlab</p>
        <p className="auth-caption">Acceso del profesorado</p>
      </div>
    </header>
    <div className="auth-split">
      <section className="auth-hero" aria-label="Presentación">
        <p className="auth-hero-kicker">Para docentes de primaria</p>
        <h2 className="auth-hero-title">Aprender jugando.<br /><span>Acompañar mejor.</span></h2>
        <p className="auth-hero-text">Actividades digitales, observación docente e indicadores de atención y memoria conectados en un solo lugar. Apoyo pedagógico, no diagnóstico.</p>
      </section>
      <main id="contenido" className="auth-main">{children}</main>
    </div>
    <footer className="auth-footer">Kudlab · Apoyo al seguimiento pedagógico</footer>
  </div>;
}
