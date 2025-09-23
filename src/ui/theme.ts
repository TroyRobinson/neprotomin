type ThemeName = "light" | "dark";

type ThemeListener = (theme: ThemeName) => void;

const STORAGE_KEY = "ne.theme";

const getPreferredTheme = (): ThemeName => {
  const stored = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
  if (stored === "light" || stored === "dark") {
    return stored;
  }

  if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
};

const applyTheme = (theme: ThemeName) => {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  root.setAttribute("data-theme", theme);
};

class ThemeController {
  private theme: ThemeName;
  private listeners = new Set<ThemeListener>();

  constructor() {
    this.theme = getPreferredTheme();
    applyTheme(this.theme);
  }

  getTheme(): ThemeName {
    return this.theme;
  }

  toggle(): void {
    this.setTheme(this.theme === "dark" ? "light" : "dark");
  }

  setTheme(theme: ThemeName): void {
    if (theme === this.theme) {
      return;
    }

    this.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(theme);
    this.listeners.forEach((listener) => listener(theme));
  }

  subscribe(listener: ThemeListener): () => void {
    this.listeners.add(listener);
    listener(this.theme);
    return () => this.listeners.delete(listener);
  }
}

export const themeController = new ThemeController();
