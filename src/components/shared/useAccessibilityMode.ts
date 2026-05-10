"use client";

import { useEffect, useState } from "react";

export type AccessibilityMode = "default" | "easy";

const ACCESSIBILITY_STORAGE_KEY = "sistalvo-accessibility";
const ACCESSIBILITY_EVENT = "sistalvo-accessibility-change";

function readAccessibilityMode(): AccessibilityMode {
  if (typeof document !== "undefined") {
    const datasetValue = document.documentElement.dataset.accessibility;

    if (datasetValue === "easy") {
      return "easy";
    }
  }

  if (typeof window !== "undefined") {
    return window.localStorage.getItem(ACCESSIBILITY_STORAGE_KEY) === "easy" ? "easy" : "default";
  }

  return "default";
}

export default function useAccessibilityMode() {
  const [mode, setMode] = useState<AccessibilityMode>("default");

  useEffect(() => {
    const syncMode = () => setMode(readAccessibilityMode());

    syncMode();
    window.addEventListener(ACCESSIBILITY_EVENT, syncMode as EventListener);
    window.addEventListener("storage", syncMode);

    return () => {
      window.removeEventListener(ACCESSIBILITY_EVENT, syncMode as EventListener);
      window.removeEventListener("storage", syncMode);
    };
  }, []);

  return mode;
}
