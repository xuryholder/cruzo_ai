'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/contacts', label: 'Contacts' },
  { href: '/generate', label: 'Generate' },
  { href: '/studio', label: 'Studio' },
  { href: '/integrations', label: 'Integrations' },
  { href: '/settings', label: 'Settings' },
] as const;

export function CruzoShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="crz-shell">
      <aside className="crz-sidebar">
        <Link href="/dashboard" className="crz-brand">
          Cruzo AI
        </Link>

        <nav className="crz-nav">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`crz-nav-link ${active ? 'crz-nav-link-active' : ''}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="crz-main-wrap">
        <header className="crz-topbar">
          <input className="crz-search" placeholder="Search contacts, drafts, channels" />
          <div className="crz-top-actions">
            <Link href="/contacts" className="crz-btn">
              Add Contact
            </Link>
            <Link href="/generate" className="crz-btn crz-btn-primary">
              New Draft
            </Link>
          </div>
        </header>

        <main className="crz-main">{children}</main>
      </div>
    </div>
  );
}
