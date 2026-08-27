import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME } from '@/lib/shared/sessionCookie';
import { LoginForm } from '@/components/auth/LoginForm';

export default async function HomePage() {
  const cookieStore = await cookies();
  const hasSession = cookieStore.has(SESSION_COOKIE_NAME);

  if (hasSession) {
    redirect('/bulk-upload');
  }

  return <LoginForm />;
}