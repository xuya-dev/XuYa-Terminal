import { open } from "@tauri-apps/plugin-dialog";

/**
 * Open a native directory-picker. Returns the absolute path the user chose,
 * or null if they cancelled.
 */
export async function pickDirectory(): Promise<string | null> {
  return open({ directory: true, title: "选择项目目录" });
}
