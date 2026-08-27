'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

export function LogoutButton() {
  const router = useRouter();

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  };

  return (
    <button
      onClick={handleLogout}
      className="flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
    >
      <LogOut className="w-4 h-4 mr-2" />
      Logout
    </button>
  );
}