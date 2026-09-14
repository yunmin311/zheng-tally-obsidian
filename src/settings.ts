import type { Plugin } from 'obsidian';

export type CommitFormat = 'stable' | 'unicode';

export interface Settings {
  commitFormat: CommitFormat;
}

export const DEFAULT_SETTINGS: Settings = {
  commitFormat: 'stable',
};

export async function loadSettings(plugin: Plugin): Promise<Settings> {
  const data = (await plugin.loadData()) as Partial<Settings> | null;
  if (!data) return DEFAULT_SETTINGS;
  return {
    commitFormat: data.commitFormat ?? DEFAULT_SETTINGS.commitFormat,
  };
}

export async function saveSettings(plugin: Plugin, settings: Settings): Promise<void> {
  await plugin.saveData(settings);
}