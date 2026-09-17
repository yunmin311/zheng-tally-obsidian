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
  // V1 retired the experimental Unicode commit option: a historical stored
  // 'unicode' preference migrates safely to stable so production Enter can
  // never emit a non-persistent tally. Old Unicode plain text in notes is
  // left untouched (never auto-rewritten).
  if (data.commitFormat === 'unicode') return { commitFormat: 'stable' };
  return {
    commitFormat: data.commitFormat ?? DEFAULT_SETTINGS.commitFormat,
  };
}

export async function saveSettings(plugin: Plugin, settings: Settings): Promise<void> {
  await plugin.saveData(settings);
}