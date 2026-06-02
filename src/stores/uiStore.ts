import { create } from "zustand";

interface UIStore {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

const KEY = "xuya-sidebar-collapsed";

export const useUIStore = create<UIStore>((set) => ({
  sidebarCollapsed: localStorage.getItem(KEY) === "1",
  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarCollapsed;
      localStorage.setItem(KEY, next ? "1" : "0");
      return { sidebarCollapsed: next };
    }),
  setSidebarCollapsed: (collapsed) => {
    localStorage.setItem(KEY, collapsed ? "1" : "0");
    set({ sidebarCollapsed: collapsed });
  },
}));
