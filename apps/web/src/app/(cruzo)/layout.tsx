import type { ReactNode } from 'react';
import { CruzoShell } from './_components/cruzo-shell';

export default function CruzoLayout({ children }: { children: ReactNode }) {
  return <CruzoShell>{children}</CruzoShell>;
}
