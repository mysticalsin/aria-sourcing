import { humanize, humanizeText } from "../src/lib/humanizer";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.log("FAIL:", name); } }

// ---------------------------------------------------------------------------
// Em-dash / en-dash removal
// ---------------------------------------------------------------------------
{
  const inEm = "Hello world — this is great";
  const outEm = humanizeText(inEm);
  ok("em-dash: no em-dash char remains", !outEm.includes("—"));
  ok("em-dash: replaced with comma+space", outEm.includes("Hello world, this is great"));
  ok("em-dash: removed[] reports em-dash", humanize(inEm).removed.length >= 1);

  const inEn = "range 5–10 items"; // en-dash –
  const outEn = humanizeText(inEn);
  ok("en-dash: no en-dash char remains", !outEn.includes("–"));
  ok("en-dash: still mentions range and items", outEn.includes("range") && outEn.includes("items"));

  // neither dash char should survive any humanized output
  ok("no dash chars survive combined", !/[—–]/.test(humanizeText("a — b – c")));
}

// ---------------------------------------------------------------------------
// Banned words stripped (case-insensitive): leverage / utilize / robust /
// seamless / delve / elevate
// ---------------------------------------------------------------------------
{
  const banned = /\b(leverage|utilize|robust|seamless|delve|elevate)\b/i;

  const src = "We Leverage and UTILIZE a Robust, Seamless approach to Delve into and Elevate results.";
  const out = humanizeText(src);
  ok("banned: none remain (mixed case)", !banned.test(out));
  ok("banned: output non-empty", out.trim().length > 0);

  // each one individually
  const cases = ["leverage", "utilize", "robust", "seamless", "delve", "elevate",
                 "LEVERAGE", "Utilize", "ROBUST", "Seamless", "DELVE", "Elevate"];
  for (const w of cases) {
    const o = humanizeText(`We will ${w} the platform.`);
    ok(`banned: '${w}' stripped`, !banned.test(o));
  }

  // removed[] is non-empty when a tell is present
  ok("banned: removed[] non-empty", humanize("We leverage robust tools.").removed.length >= 1);
}

// ---------------------------------------------------------------------------
// Filler phrase removal ("I hope this email finds you well")
// ---------------------------------------------------------------------------
{
  const src = "I hope this email finds you well. Let's talk about the role.";
  const out = humanizeText(src);
  ok("filler: phrase removed", !/hope this email finds you well/i.test(out));
  ok("filler: remaining content kept", out.includes("Let's talk about the role"));
  ok("filler: removed[] reports it", humanize(src).removed.length >= 1);
}

// ---------------------------------------------------------------------------
// Idempotency: humanizeText(humanizeText(x)) === humanizeText(x)
// ---------------------------------------------------------------------------
{
  const samples = [
    "I hope this email finds you well — we leverage robust, seamless tools to delve into synergy!!",
    "We will utilize cutting-edge tech to elevate the team — seamlessly.",
    "Thanks for your time, looking forward to the call.",
    "range 5–10 items, robust and tailored",
    "",
  ];
  for (const s of samples) {
    const once = humanizeText(s);
    const twice = humanizeText(once);
    ok(`idempotent: ${JSON.stringify(s).slice(0, 30)}`, once === twice);
  }
}

// ---------------------------------------------------------------------------
// Does NOT blank out ordinary, clean text
// ---------------------------------------------------------------------------
{
  const clean = "Thanks for your time, looking forward to the call.";
  const out = humanizeText(clean);
  ok("clean: output non-empty", out.trim().length > 0);
  ok("clean: keeps 'Thanks'", out.includes("Thanks"));
  ok("clean: keeps 'call'", out.includes("call"));
  ok("clean: roughly unchanged", out === clean);
}

// ---------------------------------------------------------------------------
// humanize() removed[] semantics: non-empty when tells present, empty when clean
// ---------------------------------------------------------------------------
{
  const dirty = humanize("We leverage a robust, seamless platform — truly.");
  ok("removed: non-empty when tells present", dirty.removed.length >= 1);
  ok("removed: is an array", Array.isArray(dirty.removed));
  ok("removed: de-duped (unique)", new Set(dirty.removed).size === dirty.removed.length);

  const clean = humanize("Thanks for your time. I will send the brief tomorrow.");
  ok("removed: empty for clean text", clean.removed.length === 0);
  ok("removed: clean text unchanged", clean.text === "Thanks for your time. I will send the brief tomorrow.");

  const empty = humanize("");
  ok("removed: empty input -> empty removed", empty.removed.length === 0);
  ok("removed: empty input -> empty text", empty.text === "");
}

// ---------------------------------------------------------------------------
// Robustness: never throws on odd input
// ---------------------------------------------------------------------------
{
  let threw = false;
  try {
    humanizeText("!!!! ,, —— –– leverage leverage utilize");
    humanize("\n\n\n   —  \t");
  } catch { threw = true; }
  ok("robust: no throw on odd input", !threw);
}

console.log(`RESULT humanizer: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
