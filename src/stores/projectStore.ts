import { create } from "zustand";

export interface Project {
  id: string;
  name: string;
  path: string;
  addedAt: number;
}

interface ProjectStore {
  projects: Project[];
  activeId: string | null;

  addProject: (path: string) => void;
  removeProject: (id: string) => void;
  setActive: (id: string) => void;
  getActivePath: () => string | null;
}

const PROJECTS_KEY = "xuya-projects";
const ACTIVE_KEY = "xuya-active-project";

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveProjects(projects: Project[]) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

function saveActiveId(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

/** Extract the last segment of a path (handles both / and \). */
function basename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return trimmed.slice(idx + 1) || trimmed;
}

export const useProjectStore = create<ProjectStore>((set, get) => {
  const projects = loadProjects();
  let activeId = localStorage.getItem(ACTIVE_KEY);
  // Validate: activeId must still exist in projects list.
  if (activeId && !projects.some((p) => p.id === activeId)) {
    activeId = projects.length > 0 ? projects[0].id : null;
    saveActiveId(activeId);
  }

  return {
    projects,
    activeId,

    addProject: (path) => {
      const { projects } = get();
      // Deduplicate by path.
      if (projects.some((p) => p.path === path)) return;
      const id = `proj-${Date.now()}`;
      const project: Project = {
        id,
        name: basename(path),
        path,
        addedAt: Date.now(),
      };
      const next = [...projects, project];
      saveProjects(next);
      // Auto-activate the first project added.
      const activeId = next.length === 1 ? id : get().activeId;
      saveActiveId(activeId);
      set({ projects: next, activeId });
    },

    removeProject: (id) => {
      const { projects, activeId } = get();
      const next = projects.filter((p) => p.id !== id);
      saveProjects(next);
      let newActive = activeId;
      if (activeId === id) {
        newActive = next.length > 0 ? next[0].id : null;
        saveActiveId(newActive);
      }
      set({ projects: next, activeId: newActive });
    },

    setActive: (id) => {
      saveActiveId(id);
      set({ activeId: id });
    },

    getActivePath: () => {
      const { projects, activeId } = get();
      if (!activeId) return null;
      return projects.find((p) => p.id === activeId)?.path ?? null;
    },
  };
});
