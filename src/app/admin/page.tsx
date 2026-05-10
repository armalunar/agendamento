import Link from "next/link";
import { cookies } from "next/headers";
import AdminAccessGate from "@/components/admin/AdminAccessGate";
import AdminDashboard from "@/components/admin/AdminDashboard";
import BrandLogo from "@/components/shared/BrandLogo";
import { hasAdminAccess } from "@/lib/adminAccess";

export default async function AdminPage() {
  const cookieStore = await cookies();
  const unlocked = hasAdminAccess(cookieStore);

  return (
    <main className="container">
      <nav className="nav">
        <Link href="/" className="brand brand-home" aria-label="Sistalvo">
          <BrandLogo />
        </Link>
        <div className="nav-links">
          <Link href="/" className="nav-link">
            Site
          </Link>
          <Link href="/consulta" className="nav-link">
            Consulta
          </Link>
        </div>
      </nav>

      {unlocked ? (
        <AdminDashboard />
      ) : (
        <section className="locked-admin-shell">
          <div className="section-head">
            <div className="badge">Área administrativa reservada</div>
            <h1>Entrada discreta, acesso só seu</h1>
            <p>
              O painel saiu da navegação pública e agora só abre depois da sua chave privada. Depois disso, o login do
              Firebase continua sendo exigido normalmente.
            </p>
          </div>
          <AdminAccessGate />
        </section>
      )}
    </main>
  );
}
