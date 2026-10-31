export type ImportProgress = { done: number; total: number; file: string };

export type ImportResult =
  | { skipped: string }
  | { files: number; renamed: number; rewritten: number; sealedSkipped: number; skipped?: undefined };

export function findHarness(repoGuess: string): string | null;

export function importLibrary(options: {
  from: string;
  to: string;
  fromOwner: string;
  toOwner: string;
  onProgress?: (progress: ImportProgress) => void;
}): Promise<ImportResult>;
