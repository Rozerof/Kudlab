import type { ReactNode } from 'react';
import lectura from '@/assets/fotos/lectura.webp';
import ventana from '@/assets/fotos/ventana.webp';
import juego from '@/assets/fotos/juego.webp';

// Fotografías de Pexels (licencia libre): thirdman 8926541 y 8926548, Gustavo Fring 5621973.
function AuthGallery() {
  return <aside className="auth-gallery" aria-hidden="true">
    <img className="auth-photo auth-photo-main" src={lectura} alt="" loading="eager" />
    <img className="auth-photo" src={ventana} alt="" loading="lazy" />
    <img className="auth-photo" src={juego} alt="" loading="lazy" />
    <p className="auth-gallery-caption">Aprender jugando: apoyo al seguimiento de la atención y la memoria en el aula.</p>
  </aside>;
}

export function StaffLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={wide ? 'auth-page workspace-page' : 'auth-page'}>
    {!wide && <header className="auth-header">
      <div className="auth-header-inner">
        <p className="auth-brand">Kudlab</p>
        <p className="auth-caption">Acceso del profesorado</p>
      </div>
    </header>}
    {wide ? <main id="contenido" className="staff-main">{children}</main>
      : <div className="auth-split"><AuthGallery /><main id="contenido" className="auth-main">{children}</main></div>}
    {!wide && <footer className="auth-footer">Kudlab · Apoyo al seguimiento pedagógico</footer>}
  </div>;
}
