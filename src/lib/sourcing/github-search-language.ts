/**
 * GitHub /search/users `language:` is only valid for real programming languages.
 * Product platforms (Calypso) and protocols (gRPC) are keyword tokens.
 */
export const GITHUB_SEARCH_LANGUAGES = new Set([
  "python",
  "shell",
  "java",
  "javascript",
  "typescript",
  "go",
  "ruby",
  "c++",
  "c",
  "rust",
  "php",
  "scala",
  "kotlin",
  "swift",
  "sql",
]);

export function githubSkillQueryToken(skill: string): string {
  const trimmed = skill.trim();
  if (!trimmed) return "";
  const compact = trimmed.replace(/\s+/g, "");
  if (GITHUB_SEARCH_LANGUAGES.has(compact.toLowerCase())) return `language:${compact}`;
  // Never emit language:LinuxPythonShell… for an unsplit Skill (Must) line.
  if (/\s/.test(trimmed)) {
    const first = trimmed.split(/\s+/)[0] ?? trimmed;
    return GITHUB_SEARCH_LANGUAGES.has(first.toLowerCase()) ? `language:${first}` : first;
  }
  return compact;
}
