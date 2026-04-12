import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useUiStore } from '../../stores/uiStore';

export function AppLayout() {
  const { sidebarCollapsed, toggleSidebar } = useUiStore();

  // Cmd+\ to toggle sidebar
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleSidebar]);

  return (
    <div className="h-screen flex overflow-hidden bg-white">
      {/* Sidebar */}
      {!sidebarCollapsed && (
        <div className="w-56 flex-shrink-0">
          <Sidebar />
        </div>
      )}

      {/* Collapsed sidebar indicator */}
      {sidebarCollapsed && (
        <button
          onClick={toggleSidebar}
          className="fixed left-0 top-1/2 -translate-y-1/2 z-10 bg-gray-900 text-gray-400 hover:text-white px-1 py-3 rounded-r-md transition-colors"
          title="Show sidebar (⌘\)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
