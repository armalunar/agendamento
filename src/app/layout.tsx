import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import BrandLogo from "@/components/shared/BrandLogo";
import LiveChatWidget from "@/components/shared/LiveChatWidget";
import ThemeToggle from "@/components/shared/ThemeToggle";
import { BUSINESS_LOGO_PATH, BUSINESS_NAME } from "@/lib/business";
import "./globals.css";

const headingFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading"
});

const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-body"
});

export const metadata: Metadata = {
  title: `${BUSINESS_NAME} | Serviços para computador`,
  description: "Catálogo de serviços para manutenção, formatação, backup, segurança e configuração de computador com agendamento online.",
  icons: {
    icon: BUSINESS_LOGO_PATH,
    shortcut: BUSINESS_LOGO_PATH,
    apple: BUSINESS_LOGO_PATH
  },
  applicationName: BUSINESS_NAME
};

const themeSetupScript = `
  (function () {
    try {
      var storedTheme = localStorage.getItem("sistalvo-theme");
      var storedAccessibility = localStorage.getItem("sistalvo-accessibility");
      var theme = storedTheme === "dark" ? "dark" : "light";
      var accessibility = storedAccessibility === "easy" ? "easy" : "default";
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.accessibility = accessibility;
      document.documentElement.style.colorScheme = theme;
    } catch (error) {}
  })();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" data-theme="light" data-accessibility="default" suppressHydrationWarning>
      <body className={`${headingFont.variable} ${bodyFont.variable}`}>
        <script dangerouslySetInnerHTML={{ __html: themeSetupScript }} />
        <ThemeToggle />
        <LiveChatWidget />
        {children}
        <footer className="site-footer">
          <div className="site-footer-inner">
            <div className="site-footer-brand">
              <BrandLogo showName size="footer" />
              <span>Código criado por Miguel Arcanjo</span>
            </div>

            <div className="site-footer-meta">
              <span>Atendimento em Patos - PB e região</span>
              <a href="https://github.com/armalunar" target="_blank" rel="noreferrer">
                github.com/armalunar
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
