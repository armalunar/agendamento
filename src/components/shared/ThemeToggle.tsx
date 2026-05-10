"use client";

import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";
type AccessibilityMode = "default" | "easy";

const THEME_STORAGE_KEY = "sistalvo-theme";
const ACCESSIBILITY_STORAGE_KEY = "sistalvo-accessibility";
const ACCESSIBILITY_EVENT = "sistalvo-accessibility-change";

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

function applyAccessibility(mode: AccessibilityMode) {
  document.documentElement.dataset.accessibility = mode;
  localStorage.setItem(ACCESSIBILITY_STORAGE_KEY, mode);
  window.dispatchEvent(new CustomEvent(ACCESSIBILITY_EVENT, { detail: mode }));
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [accessibility, setAccessibility] = useState<AccessibilityMode>("default");

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    const nextTheme: ThemeMode = stored === "dark" ? "dark" : "light";
    const storedAccessibility = localStorage.getItem(ACCESSIBILITY_STORAGE_KEY);
    const nextAccessibility: AccessibilityMode = storedAccessibility === "easy" ? "easy" : "default";
    setTheme(nextTheme);
    setAccessibility(nextAccessibility);
    applyTheme(nextTheme);
    applyAccessibility(nextAccessibility);
  }, []);

  function handleThemeChange(nextTheme: ThemeMode) {
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  function handleAccessibilityChange(nextMode: AccessibilityMode) {
    setAccessibility(nextMode);
    applyAccessibility(nextMode);
  }

  return (
    <div className="theme-toggle" aria-label="Controles visuais">
      <span className="theme-toggle-label">Tema</span>
      <div className="theme-toggle-buttons">
        <button
          type="button"
          className={`theme-toggle-btn ${theme === "light" ? "active" : ""}`}
          aria-pressed={theme === "light"}
          onClick={() => handleThemeChange("light")}
        >
          Claro
        </button>
        <button
          type="button"
          className={`theme-toggle-btn ${theme === "dark" ? "active" : ""}`}
          aria-pressed={theme === "dark"}
          onClick={() => handleThemeChange("dark")}
        >
          Escuro
        </button>
      </div>

      <span className="theme-toggle-label">Leitura</span>
      <div className="theme-toggle-buttons">
        <button
          type="button"
          className={`theme-toggle-btn ${accessibility === "default" ? "active" : ""}`}
          aria-pressed={accessibility === "default"}
          onClick={() => handleAccessibilityChange("default")}
        >
          Padrão
        </button>
        <button
          type="button"
          className={`theme-toggle-btn ${accessibility === "easy" ? "active" : ""}`}
          aria-pressed={accessibility === "easy"}
          onClick={() => handleAccessibilityChange("easy")}
        >
          Fácil
        </button>
      </div>
    </div>
  );
}
