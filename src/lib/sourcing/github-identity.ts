/** GitHub's documented login grammar, shared by the API and client action. */
export const GITHUB_USERNAME_RE = /^[a-zA-Z\d](?:[a-zA-Z\d]|-(?=[a-zA-Z\d])){0,38}$/;

export interface GithubUser {
  login: string;
  name: string | null;
  email: string | null;
  company: string | null;
  location: string | null;
  bio: string | null;
  blog: string | null;
  htmlUrl: string;
  publicRepos: number;
  followers: number;
  createdAt: string | null; // account creation - a rough proxy for time in the field
  topLanguage: string | null; // parsed from the search query's `language:` filter
}
