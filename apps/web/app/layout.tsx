import type { Metadata } from "next";
import "./globals.css";
import Header from "./components/Header";
import s from "./components/Shell.module.css";

export const metadata: Metadata = { title: "Tech Intel", description: "One place to understand tech right now." };

// Applies the stored theme before first paint so an explicit dark choice never
// flashes light. Kept tiny and dependency-free; ThemeToggle owns the state.
const THEME_BOOT = `try{var t=localStorage.getItem("ti-theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the boot script below sets data-theme before
    // React hydrates, so <html> intentionally differs from the server render.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <Header />
        <main className={s.page}>{children}</main>
      </body>
    </html>
  );
}
