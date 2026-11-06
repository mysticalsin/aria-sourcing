// Reads the GraphQL query id and variable names out of a messaging request
// made by LinkedIn's own web app. LinkedIn rotates these ids; reporting the
// live ones keeps ARIA's requests identical to the web app's.

const QUERY_ID = /^(messengerConversations|messengerMessages)\.[0-9a-f]{32}$/;

/** Top-level names of a Rest.li tuple body: "a:1,b:(c:2,d:3),e:x" -> [a, b, e]. */
export function topLevelKeys(inner) {
  const keys = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= inner.length; i += 1) {
    const c = inner[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if ((c === "," && depth === 0) || i === inner.length) {
      const key = inner.slice(start, i).split(":")[0];
      if (/^[A-Za-z]{1,40}$/.test(key)) keys.push(key);
      start = i + 1;
    }
  }
  return keys;
}

/**
 * @param {string} url
 * @returns {{ name: string, queryId: string, variables: string[] } | null}
 */
export function parseCapturedQuery(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const queryId = parsed.searchParams.get("queryId") || "";
  const match = QUERY_ID.exec(queryId);
  if (!match) return null;
  // Values are percent-encoded, so the tuple ends at the first ")" that is
  // followed by the next parameter or the end of the query.
  const rawVariables = /[?&]variables=\((.*?)\)(?:&|$)/.exec(parsed.search);
  return { name: match[1], queryId, variables: rawVariables ? topLevelKeys(rawVariables[1]) : [] };
}
