import { create } from 'zustand';

type ActiveView = 'all' | 'pinned' | 'archived' | 'trash' | 'thoughts' | 'dashboard' | 'folder';

interface UiState {
  selectedFolderId: string | null;
  selectedNoteId: string | null;
  sidebarCollapsed: boolean;
  activeView: ActiveView;
  searchQuery: string;
  setSelectedFolder: (folderId: string | null) => void;
  setSelectedNote: (noteId: string | null) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setActiveView: (view: ActiveView) => void;
  setSearchQuery: (q: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedFolderId: null,
  selectedNoteId: null,
  sidebarCollapsed: false,
  activeView: 'all',
  searchQuery: '',
  setSelectedFolder: (folderId) => set({ selectedFolderId: folderId, activeView: folderId ? 'folder' : 'all' }),
  setSelectedNote: (noteId) => set({ selectedNoteId: noteId }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setActiveView: (activeView) => set({ activeView, selectedFolderId: activeView !== 'folder' ? null : undefined }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
}));
