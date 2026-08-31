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
  const token = skill.replace(/\s+/g, "");
  return GITHUB_SEARCH_LANGUAGES.has(token.toLowerCase()) ? `language:${token}` : token;
}
