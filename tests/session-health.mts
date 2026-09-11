import assert from "node:assert/strict";
import {
  classifySessionProbe,
  isLinkedInRecruiterUrl,
  looksLikeLinkedInAuthWall,
} from "../src/lib/session-health.ts";

assert.equal(
  looksLikeLinkedInAuthWall("", "Sign in", "https://www.linkedin.com/login"),
  true,
);
assert.equal(
  looksLikeLinkedInAuthWall("S’identifier", "Connexion", "https://www.linkedin.com/uas/login-cap"),
  true,
);
assert.equal(
  classifySessionProbe({
    url: "https://www.linkedin.com/uas/login?session_redirect=%2Ftalent%2Fhome",
    title: "LinkedIn Login",
    text: "Sign in",
  }).healthy,
  false,
);

{
  const r = classifySessionProbe({
    url: "https://www.linkedin.com/feed/",
    title: "Feed | LinkedIn",
    text: "Start a post",
  });
  assert.equal(r.healthy, true);
  assert.match(r.detail, /logged in/i);
}

assert.equal(isLinkedInRecruiterUrl("https://www.linkedin.com/talent/home"), true);
{
  // Logged-out / empty talent landing must NOT count as healthy
  const soft = classifySessionProbe({
    url: "https://www.linkedin.com/talent/home",
    title: "LinkedIn Recruiter",
    text: "Welcome",
  });
  assert.equal(soft.healthy, false);
}
{
  const r = classifySessionProbe({
    url: "https://www.linkedin.com/talent/hire/123/discover/candidates",
    title: "LinkedIn Recruiter",
    text: "Projects and pipeline for candidates",
  });
  assert.equal(r.healthy, true);
  assert.match(r.detail, /Recruiter/i);
}

{
  const r = classifySessionProbe({
    url: "https://example.com/",
    title: "Example",
    text: "hello",
  });
  assert.equal(r.healthy, false);
}

console.log("session-health: ok");
