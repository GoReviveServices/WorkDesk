import { LogoutButton } from '@/components/auth/LogoutButton';
import { NavLinks } from '@/components/auth/NavLinks';
import { SyncCategoryMapButton } from '@/components/auth/SyncCategoryMapButton';
import { SyncPciIdsButton } from '@/components/auth/SyncPciIdsButton';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      <nav className="bg-white shadow-sm border-b border-gray-200 px-6 py-4 flex justify-between items-center gap-4 flex-wrap">
        <h1 className="text-xl text-gray-900 flex flex-col tracking-tight">
          WorkDesk<span className="text-zinc-500 text-xs">Cognitive.AI</span>
        </h1>
        <NavLinks />
        <div className="flex items-center gap-3">
          <SyncCategoryMapButton />
          <SyncPciIdsButton />
          <LogoutButton />
        </div>
      </nav>

      <main className="px-4 sm:px-6 lg:px-8 mt-8">{children}</main>
    </div>
  );
}