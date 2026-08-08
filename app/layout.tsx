import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aegis — unit economics for agentic engineering",
  description: "Attributes every AI session to the unit of work that caused it.",
};

const NAV = [
  { href: "/", label: "Sprint" },
  { href: "/me", label: "My projects" },
  { href: "/live", label: "Live" },
  { href: "/settings/keys", label: "Keys" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-[var(--color-edge)]">
          <div className="mx-auto flex max-w-6xl items-baseline gap-8 px-6 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Aegis
            </Link>
            <nav className="flex gap-5 text-sm text-[var(--color-muted)]">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-[var(--color-text)]">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
