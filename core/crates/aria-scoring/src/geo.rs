//! Europe / EMEA geo signals, ported from `src/lib/geo-europe.ts`.
//!
//! Regexes use ASCII word boundaries (`(?-u:\b)`), matching JavaScript `\b`
//! without the `u` flag. Case folding is ASCII-insensitive where the
//! TypeScript patterns use the `i` flag.

use regex::Regex;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

const EUROPE_PLACE: &str = r"(?-u:\b)(?:europe|european|emea|eea|(?-u:\beu\b)|(?-u:\buk\b)|(?-u:\bgb\b)|united\s+kingdom|great\s+britain|england|scotland|wales|ireland|northern\s+ireland|germany|france|netherlands|holland|belgium|spain|italy|portugal|switzerland|austria|sweden|norway|denmark|finland|poland|czech(?:ia|\s+republic)?|romania|hungary|greece|luxembourg|slovakia|slovenia|croatia|bulgaria|estonia|latvia|lithuania|iceland|malta|cyprus|amsterdam|berlin|munich|hamburg|frankfurt|paris|lyon|london|manchester|dublin|madrid|barcelona|lisbon|rome|milan|brussels|zurich|geneva|vienna|stockholm|copenhagen|helsinki|oslo|warsaw|prague|budapest|athens|edinburgh|glasgow|birmingham|cologne|dusseldorf|rotterdam|the\s+hague)(?-u:\b)";

const EUROPE_TZ: &str = r"(?-u:\b)(?:CET|CEST|WET|WEST|BST|GMT|Europe/[A-Za-z_]+)(?-u:\b)";

const AMERICAS_TZ: &str = r"(?-u:\b)(?:EST|EDT|PST|PDT|CST|CDT|MST|MDT|AKST|HST|BRT|ART|America/[A-Za-z_]+|US/[A-Za-z_]+)(?-u:\b)";

const AMERICAS_PLACE: &str = r"(?-u:\b)(?:united\s+states|(?-u:\busa\b)|(?-u:\bu\.s\.a\.?\b)|(?-u:\bus\b)|canada|mexico|brazil|argentina|chile|colombia|peru|toronto|montreal|montr[eé]al|vancouver|ottawa|calgary|new\s+york|san\s+francisco|seattle|chicago|austin|boston|los\s+angeles|miami|denver|atlanta|dallas|portland|eugene|sao\s+paulo|s[aã]o\s+paulo|buenos\s+aires|mexico\s+city|latam|americas?|oregon|california|washington|texas|florida|illinois|massachusetts|colorado|georgia|arizona|nevada|ohio|michigan|pennsylvania|virginia|north\s+carolina|new\s+jersey)(?-u:\b)";

const ASIA_TZ: &str = r"(?-u:\b)(?:IST|SGT|JST|KST|HKT|PHT|AEST|AEDT|ACST|AWST|Asia/[A-Za-z_]+|Australia/[A-Za-z_]+)(?-u:\b)";

const ASIA_PLACE: &str = r"(?-u:\b)(?:india|singapore|japan|korea|hong\s+kong|philippines|thailand|vietnam|indonesia|malaysia|china|taiwan|australia|new\s+zealand|bangalore|bengaluru|mumbai|delhi|hyderabad|chennai|pune|tokyo|osaka|seoul|sydney|melbourne|auckland|shanghai|beijing|apac|asia[\s-]?pacific)(?-u:\b)";

const EUROPE_FOCUS_MACRO: &str =
    r"(?-u:\b)(?:europe|european|emea|eea|(?-u:\beu\b)|(?-u:\buk\b)|(?-u:\bgb\b))(?-u:\b)";

fn compile(pattern: &str) -> Regex {
    // `(?-u:\b)` inside the pattern is an ASCII word boundary, matching
    // JavaScript `\b` without the `u` flag. Literals such as `é` stay Unicode.
    Regex::new(&format!("(?i){pattern}")).unwrap_or_else(|err| panic!("geo regex: {err}"))
}

static EUROPE_PLACE_RE: LazyLock<Regex> = LazyLock::new(|| compile(EUROPE_PLACE));
static EUROPE_TZ_RE: LazyLock<Regex> = LazyLock::new(|| compile(EUROPE_TZ));
static AMERICAS_TZ_RE: LazyLock<Regex> = LazyLock::new(|| compile(AMERICAS_TZ));
static AMERICAS_PLACE_RE: LazyLock<Regex> = LazyLock::new(|| compile(AMERICAS_PLACE));
static ASIA_TZ_RE: LazyLock<Regex> = LazyLock::new(|| compile(ASIA_TZ));
static ASIA_PLACE_RE: LazyLock<Regex> = LazyLock::new(|| compile(ASIA_PLACE));
static EUROPE_FOCUS_MACRO_RE: LazyLock<Regex> = LazyLock::new(|| compile(EUROPE_FOCUS_MACRO));
static MACRO_REGION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^(?:eu|eea|emea|europe|uk|gb)$").unwrap());
static HINT_MACRO_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?-u:\b)(?:eu|eea|emea|europe)(?-u:\b)").unwrap());
static HINT_UK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?-u:\b)(?:uk|gb|united\s+kingdom)(?-u:\b)").unwrap());
static BARE_LOCATION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:eu|eea|emea|europe|remote|global|international)$").unwrap()
});

fn text_looks_european(text: &str) -> bool {
    EUROPE_PLACE_RE.is_match(text) || EUROPE_TZ_RE.is_match(text)
}

fn text_looks_americas(text: &str) -> bool {
    AMERICAS_PLACE_RE.is_match(text) || AMERICAS_TZ_RE.is_match(text)
}

fn text_looks_asia_pacific(text: &str) -> bool {
    ASIA_PLACE_RE.is_match(text) || ASIA_TZ_RE.is_match(text)
}

pub fn job_is_europe_focused(regions: &[&str], timezone: &str, location: &str) -> bool {
    let blobs = regions
        .iter()
        .copied()
        .chain([timezone, location])
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if blobs.trim().is_empty() {
        return false;
    }
    if EUROPE_FOCUS_MACRO_RE.is_match(&blobs) {
        return true;
    }
    if EUROPE_TZ_RE.is_match(&blobs) && !AMERICAS_TZ_RE.is_match(timezone) {
        return true;
    }
    EUROPE_PLACE_RE.is_match(&blobs)
}

pub fn candidate_matches_europe(location: &str, timezone: &str) -> bool {
    let blob = format!("{location} {timezone}");
    let blob = blob.trim();
    if blob.is_empty() {
        return false;
    }
    text_looks_european(blob)
}

pub fn candidate_is_far_from_europe(location: &str, timezone: &str) -> bool {
    if candidate_matches_europe(location, timezone) {
        return false;
    }
    let blob = format!("{location} {timezone}");
    let blob = blob.trim();
    if blob.is_empty() {
        return false;
    }
    text_looks_americas(blob) || text_looks_asia_pacific(blob)
}

pub fn location_matches_europe_macro(location: &str, region: &str) -> bool {
    let reg = region.trim();
    if !MACRO_REGION_RE.is_match(reg) {
        return false;
    }
    text_looks_european(&location.trim().to_lowercase())
}

/// JavaScript `RegExp` escape, then whitespace runs become `\s+`.
fn escape_js_regex(region_lower: &str) -> String {
    let mut escaped = String::with_capacity(region_lower.len());
    for ch in region_lower.chars() {
        if ".*+?^${}()|[]\\".contains(ch) {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    let mut out = String::with_capacity(escaped.len());
    let mut chars = escaped.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch.is_whitespace() {
            while chars.peek().is_some_and(|c| c.is_whitespace()) {
                chars.next();
            }
            out.push_str(r"\s+");
        } else {
            out.push(ch);
        }
    }
    out
}

pub fn location_matches_region(location: &str, region: &str) -> bool {
    if region.trim().to_lowercase() == "global" {
        return true;
    }
    let loc = location.trim().to_lowercase();
    let reg = region.trim().to_lowercase();
    if loc.is_empty() || reg.is_empty() {
        return false;
    }
    if location_matches_europe_macro(&loc, &reg) {
        return true;
    }
    let escaped = escape_js_regex(&reg);
    if escaped.is_empty() {
        return false;
    }
    let pattern = format!(r"(?i)(?:^|[^a-z0-9]){escaped}(?:$|[^a-z0-9])");
    static REGION_REGEX: LazyLock<Mutex<HashMap<String, Regex>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    let compiled = {
        let mut cache = REGION_REGEX.lock().unwrap_or_else(|err| err.into_inner());
        cache
            .entry(pattern)
            .or_insert_with_key(|pattern| Regex::new(pattern).expect("region pattern"))
            .clone()
    };
    compiled.is_match(location)
}

pub fn europe_sourcing_hints(regions: &[&str], timezone: &str, location: &str) -> Vec<String> {
    if !job_is_europe_focused(regions, timezone, location) {
        return Vec::new();
    }
    let mut hints: Vec<String> = Vec::new();
    let push = |hints: &mut Vec<String>, value: &str| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return;
        }
        if hints
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(trimmed))
        {
            return;
        }
        hints.push(trimmed.to_string());
    };
    if !location.trim().is_empty() && !BARE_LOCATION_RE.is_match(location.trim()) {
        push(&mut hints, location.trim());
    }
    for region in regions {
        let trimmed = region.trim();
        if BARE_LOCATION_RE.is_match(trimmed) {
            continue;
        }
        if trimmed.eq_ignore_ascii_case("uk") || trimmed.eq_ignore_ascii_case("gb") {
            push(&mut hints, "United Kingdom");
        } else {
            push(&mut hints, trimmed);
        }
    }
    let macro_blob = format!("{} {}", regions.join(" "), location);
    if HINT_MACRO_RE.is_match(&macro_blob) || EUROPE_TZ_RE.is_match(timezone) {
        for hint in [
            "Germany",
            "United Kingdom",
            "France",
            "Netherlands",
            "Spain",
        ] {
            push(&mut hints, hint);
        }
    } else if HINT_UK_RE.is_match(&macro_blob) {
        push(&mut hints, "United Kingdom");
        push(&mut hints, "London");
    }
    hints.truncate(6);
    hints
}
