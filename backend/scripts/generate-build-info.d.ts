export interface GeneratedBuildInfo {
  commit: string;
  builtAt: string;
}

export function generate(outputDir: string): GeneratedBuildInfo;
export function resolveCommit(): string;
