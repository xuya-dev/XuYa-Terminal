import { create } from "zustand";

export type SettingsTab = "appearance" | "terminal" | "agents" | "sessions";
export type ModalKind = "settings" | "about" | null;

interface ModalStore {
  /** Which centered modal is open (settings / about), or null. */
  modal: ModalKind;
  settingsTab: SettingsTab;
  /** Command-palette visibility (separate — it's an overlay, not a modal). */
  paletteOpen: boolean;

  openModal: (m: Exclude<ModalKind, null>, settingsTab?: SettingsTab) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  closeModal: () => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
}

export const useModalStore = create<ModalStore>((set) => ({
  modal: null,
  settingsTab: "appearance",
  paletteOpen: false,

  openModal: (m, settingsTab) =>
    set((s) => ({
      modal: m,
      settingsTab: m === "settings" ? (settingsTab ?? s.settingsTab) : s.settingsTab,
      paletteOpen: false,
    })),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  closeModal: () => set({ modal: null }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
}));
