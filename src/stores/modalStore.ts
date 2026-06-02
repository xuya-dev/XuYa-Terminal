import { create } from "zustand";

export type ModalKind = "settings" | "about" | "theme" | null;

interface ModalStore {
  /** Which centered modal is open (settings / about), or null. */
  modal: ModalKind;
  /** Command-palette visibility (separate — it's an overlay, not a modal). */
  paletteOpen: boolean;

  openModal: (m: Exclude<ModalKind, null>) => void;
  closeModal: () => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
}

export const useModalStore = create<ModalStore>((set) => ({
  modal: null,
  paletteOpen: false,

  openModal: (m) => set({ modal: m, paletteOpen: false }),
  closeModal: () => set({ modal: null }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
}));
