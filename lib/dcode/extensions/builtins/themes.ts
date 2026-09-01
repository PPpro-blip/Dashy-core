/**
 * DashyCore v7 — First-party extension: `dashy.themes` (Dashy Theme Pack).
 *
 * Contributes four Monaco themes (obsidian cyan, dark classic, ocean, high
 * contrast), a "Preferences: Color Theme" quick-pick command and one
 * apply-command per theme. The selection is persisted to localStorage.
 */

import { DASHY_THEMES } from "../themes";
import { getStoredTheme, setStoredTheme } from "../storage";
import type { ExtensionModule } from "../types";

export const themesExtension: ExtensionModule = {
  manifest: {
    id: "dashy.themes",
    name: "Dashy Theme Pack",
    version: "1.0.0",
    description:
      "Monaco color themes tuned for DashyCore — obsidian cyan, dark classic, ocean and high contrast.",
    author: "DashyCore",
    categories: ["Themes"],
    contributes: {
      commands: [
        {
          id: "dashy.themes.selectTheme",
          title: "Color Theme",
          category: "Preferences",
        },
        ...DASHY_THEMES.map((theme) => ({
          id: `dashy.theme.apply.${theme.id}`,
          title: theme.label,
          category: "Theme",
        })),
      ],
      themes: DASHY_THEMES.map((theme) => ({
        id: theme.id,
        label: theme.label,
      })),
    },
    activationEvents: ["*"],
  },

  activate(context) {
    const applyTheme = (themeId: string) => {
      setStoredTheme(themeId);
      context.workspace.applyTheme(themeId);
    };

    context.registerCommand("dashy.themes.selectTheme", {
      title: "Color Theme",
      category: "Preferences",
      handler: async () => {
        const picked = await context.ui.showQuickPick(
          DASHY_THEMES.map((theme) => ({
            id: theme.id,
            label: theme.label,
            description: theme.description,
            detail: theme.id,
          })),
          "Select Color Theme"
        );
        if (picked) applyTheme(picked.id);
      },
    });

    for (const theme of DASHY_THEMES) {
      context.registerCommand(`dashy.theme.apply.${theme.id}`, {
        title: theme.label,
        category: "Theme",
        handler: () => applyTheme(theme.id),
      });
    }

    // Restore the persisted theme when the extension activates.
    const stored = getStoredTheme();
    if (DASHY_THEMES.some((t) => t.id === stored)) {
      context.workspace.applyTheme(stored);
    }
  },
};
