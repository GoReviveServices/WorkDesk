'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/bulk-upload', label: 'Bulk Upload' },
  { href: '/qc-import', label: 'QC Import' },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1">
      {LINKS.map((link) => {
        const active = pathname?.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
              active ? 'bg-orange-100 text-orange-700' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}