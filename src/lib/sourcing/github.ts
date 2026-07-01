// Real candidate sourcing via the GitHub Users Search API. READ-ONLY: this only
// searches and reads public profiles; it never writes to GitHub. The caller (the
// /api/source route) supplies a token resolved server-side and never logs it.
//
// Keyless by default: GitHub's REST API allows fully anonymous requests (no signup,
// no token) at 60 req/hour per IP, with tighter limits on the search endpoint. A
// GITHUB_TOKEN is optional and only raises the ceiling (5,000 req/hour) — it is
// never required to get real results.
//
// Honest limitation: GitHub exposes a public profile, not always an email. We take
// the public email when present and otherwise leave it blank — the candidate is a
// real person you found; finding their email is a separate enrichment step.

const GH_API = "https://api.github.com";

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
  createdAt: string | null; // account creation — a rough proxy for time in the field
  topLanguage: string | null; // parsed from the search query's `language:` filter
}

async function gh(path: string, token: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "aria-sourcing",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${GH_API}${path}`, {
    headers,
    // Single-use signal per call; the route bounds the overall work.
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
}

/**
 * Search GitHub users and resolve each to a public profile.
 *
 * `query` is a GitHub search qualifier string, e.g.
 * `language:typescript location:london followers:>50`. `count` is capped at 20.
 * `token` is optional — pass "" to run fully anonymous (60 req/hour); a real token
 * raises that to 5,000 req/hour. Per-user detail calls are sequential and bounded
 * by `count`.
 */
export async function searchGithubUsers(
  query: string,
  count: number,
  token = "",
): Promise<GithubUser[]> {
  const perPage = Math.min(Math.max(Math.trunc(count) || 1, 1), 20);
  const search = (await gh(
    `/search/users?q=${encodeURIComponent(query)}&per_page=${perPage}`,
    token,
  )) as { items?: { login?: string }[] };
  const logins = (search.items ?? [])
    .map((u) => u.login)
    .filter((l): l is string => typeof l === "string" && l.length > 0)
    .slice(0, perPage);

  const lang = query.match(/language:([A-Za-z0-9+#.\-]+)/i)?.[1] ?? null;

  const users: GithubUser[] = [];
  for (const login of logins) {
    try {
      const u = (await gh(`/users/${encodeURIComponent(login)}`, token)) as Record<string, unknown>;
      users.push({
        login: String(u.login ?? login),
        name: (u.name as string) ?? null,
        email: (u.email as string) ?? null,
        company: (u.company as string) ?? null,
        location: (u.location as string) ?? null,
        bio: (u.bio as string) ?? null,
        blog: (u.blog as string) ?? null,
        htmlUrl: String(u.html_url ?? `https://github.com/${login}`),
        publicRepos: Number(u.public_repos ?? 0),
        followers: Number(u.followers ?? 0),
        createdAt: (u.created_at as string) ?? null,
        topLanguage: lang,
      });
    } catch {
      // Skip a user whose detail fetch fails; keep the rest of the batch.
    }
  }
  return users;
}
