import { Outlet } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';
import GlobalRunIndicator from './GlobalRunIndicator';

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      {/* Main area offset by collapsed sidebar (w-16 = 4rem) */}
      <div className="pl-16">
        <AppHeader />
        <main className="h-[calc(100vh-3.5rem)] overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <GlobalRunIndicator />
    </div>
  );
}