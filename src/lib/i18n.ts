/* ============================================================================
   i18n — Aria composes outreach and reads replies in ANY language.
   Curated, faithful phrase packs for the common business languages; English is
   the safe fallback for anything unmapped. Reply classification merges keyword
   lexicons across languages so a reply in any of them routes correctly.
   ========================================================================== */

export interface Language {
  code: string;
  label: string;
  native: string;
}

export const LANGUAGES: Language[] = [
  { code: "en", label: "English", native: "English" },
  { code: "fr", label: "French", native: "Français" },
  { code: "es", label: "Spanish", native: "Español" },
  { code: "de", label: "German", native: "Deutsch" },
  { code: "pt", label: "Portuguese", native: "Português" },
  { code: "it", label: "Italian", native: "Italiano" },
  { code: "nl", label: "Dutch", native: "Nederlands" },
];

export const DEFAULT_LANGUAGE = "en";

export function languageLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code.toUpperCase();
}

/* ---- Detection (stop-word heuristic) ------------------------------------- */

const DETECT: { code: string; re: RegExp }[] = [
  { code: "fr", re: /\b(bonjour|merci|cordialement|recherche|poste|entreprise|votre|nous|être|où)\b/i },
  { code: "es", re: /\b(hola|gracias|saludos|empresa|puesto|nosotros|estás|dónde|también)\b/i },
  { code: "de", re: /\b(hallo|danke|grüße|stelle|unternehmen|wir|sind|deine|wo)\b/i },
  { code: "pt", re: /\b(olá|obrigado|atenciosamente|empresa|vaga|nós|você|onde)\b/i },
  { code: "it", re: /\b(ciao|grazie|cordiali saluti|azienda|posizione|noi|sei|dove)\b/i },
  { code: "nl", re: /\b(hallo|bedankt|groeten|bedrijf|functie|wij|jij|waar)\b/i },
];

export function detectLanguage(text: string): string {
  for (const d of DETECT) if (d.re.test(text)) return d.code;
  return "en";
}

/* ---- Outreach phrase packs ----------------------------------------------- */

export interface OutreachStrings {
  subjectNew: (title: string, topSkill: string) => string;
  subjectGeneric: (title: string) => string;
  subjectFollow: (title: string, firstName: string) => string;
  salutation: (firstName: string) => string;
  greeting: (firstName: string, topSkill: string, company: string) => string;
  roleLine: (title: string, locationType: string, regions: string) => string;
  equity: string;
  whyYou: (a: string, b?: string) => string;
  cta: string;
  ctaFollow: string;
}

const en: OutreachStrings = {
  subjectNew: (t, s) => `${t} role that fits your ${s} work`,
  subjectGeneric: (t) => `${t} opportunity`,
  subjectFollow: (t, f) => `Re: ${t} (follow-up), ${f}`,
  salutation: (f) => `Hi ${f},`,
  greeting: (f, s, c) =>
    c ? `Hi ${f}, your work with ${s} at ${c} stood out.` : `Hi ${f}, your work with ${s} stood out.`,
  roleLine: (t, l, r) => `We're hiring a ${t} (${l}, ${r}).`,
  equity: "Meaningful equity is on the table.",
  whyYou: (a, b) => `Why you, specifically: ${a}${b ? `. And ${b.toLowerCase()}` : ""}.`,
  cta: "Worth a 15-minute, no-strings call to see if it's interesting?",
  ctaFollow: "Circling back once in case this slipped, no pressure either way.",
};

const fr: OutreachStrings = {
  subjectNew: (t, s) => `Poste de ${t} en lien avec votre expérience ${s}`,
  subjectGeneric: (t) => `Opportunité de ${t}`,
  subjectFollow: (t, f) => `Re : ${t}, petite relance, ${f}`,
  salutation: (f) => `Bonjour ${f},`,
  greeting: (f, s, c) =>
    c
      ? `Bonjour ${f}, votre travail sur ${s} chez ${c} a retenu mon attention.`
      : `Bonjour ${f}, votre travail sur ${s} a retenu mon attention.`,
  roleLine: (t, l, r) => `Nous recrutons un(e) ${t} (${l}, ${r}).`,
  equity: "Un intéressement au capital est prévu.",
  whyYou: (a, b) => `Pourquoi vous : ${a}${b ? `. Et ${b.toLowerCase()}` : ""}.`,
  cta: "Un échange de 15 minutes, sans engagement, vous conviendrait-il ?",
  ctaFollow: "Je reviens vers vous au cas où, sans aucune pression.",
};

const es: OutreachStrings = {
  subjectNew: (t, s) => `Puesto de ${t} acorde con tu experiencia en ${s}`,
  subjectGeneric: (t) => `Oportunidad de ${t}`,
  subjectFollow: (t, f) => `Re: ${t}, un seguimiento, ${f}`,
  salutation: (f) => `Hola ${f},`,
  greeting: (f, s, c) =>
    c
      ? `Hola ${f}, tu trabajo con ${s} en ${c} me llamó la atención.`
      : `Hola ${f}, tu trabajo con ${s} me llamó la atención.`,
  roleLine: (t, l, r) => `Buscamos un/a ${t} (${l}, ${r}).`,
  equity: "Hay participación accionarial sobre la mesa.",
  whyYou: (a, b) => `Por qué tú: ${a}${b ? `. Y ${b.toLowerCase()}` : ""}.`,
  cta: "¿Te vendría bien una llamada de 15 minutos, sin compromiso?",
  ctaFollow: "Vuelvo a escribirte por si se traspapeló, sin ninguna presión.",
};

const de: OutreachStrings = {
  subjectNew: (t, s) => `${t}-Stelle, die zu deiner ${s}-Erfahrung passt`,
  subjectGeneric: (t) => `Position als ${t}`,
  subjectFollow: (t, f) => `Re: ${t}, kurze Nachfrage, ${f}`,
  salutation: (f) => `Hallo ${f},`,
  greeting: (f, s, c) =>
    c
      ? `Hallo ${f}, deine Arbeit mit ${s} bei ${c} ist mir aufgefallen.`
      : `Hallo ${f}, deine Arbeit mit ${s} ist mir aufgefallen.`,
  roleLine: (t, l, r) => `Wir suchen eine/n ${t} (${l}, ${r}).`,
  equity: "Eine sinnvolle Beteiligung ist möglich.",
  whyYou: (a, b) => `Warum du: ${a}${b ? `. Und ${b.toLowerCase()}` : ""}.`,
  cta: "Hättest du Lust auf ein 15-minütiges, unverbindliches Gespräch?",
  ctaFollow: "Ich melde mich nochmal, falls es untergegangen ist, ganz ohne Druck.",
};

const pt: OutreachStrings = {
  subjectNew: (t, s) => `Vaga de ${t} alinhada à sua experiência em ${s}`,
  subjectGeneric: (t) => `Oportunidade para ${t}`,
  subjectFollow: (t, f) => `Re: ${t}, um retorno, ${f}`,
  salutation: (f) => `Olá ${f},`,
  greeting: (f, s, c) =>
    c
      ? `Olá ${f}, o seu trabalho com ${s} na ${c} chamou a atenção.`
      : `Olá ${f}, o seu trabalho com ${s} chamou a atenção.`,
  roleLine: (t, l, r) => `Estamos a contratar um(a) ${t} (${l}, ${r}).`,
  equity: "Há participação societária em jogo.",
  whyYou: (a, b) => `Por que você: ${a}${b ? `. E ${b.toLowerCase()}` : ""}.`,
  cta: "Que tal uma conversa de 15 minutos, sem compromisso?",
  ctaFollow: "Retomo o contato caso tenha passado, sem qualquer pressão.",
};

const it: OutreachStrings = {
  subjectNew: (t, s) => `Posizione ${t} in linea con la tua esperienza in ${s}`,
  subjectGeneric: (t) => `Opportunità come ${t}`,
  subjectFollow: (t, f) => `Re: ${t}, un promemoria, ${f}`,
  salutation: (f) => `Ciao ${f},`,
  greeting: (f, s, c) =>
    c
      ? `Ciao ${f}, il tuo lavoro con ${s} in ${c} ha colpito.`
      : `Ciao ${f}, il tuo lavoro con ${s} ha colpito.`,
  roleLine: (t, l, r) => `Cerchiamo un/una ${t} (${l}, ${r}).`,
  equity: "È prevista una partecipazione azionaria.",
  whyYou: (a, b) => `Perché tu: ${a}${b ? `. E ${b.toLowerCase()}` : ""}.`,
  cta: "Ti andrebbe una call di 15 minuti, senza impegno?",
  ctaFollow: "Ti riscrivo nel caso fosse sfuggito, senza alcuna pressione.",
};

const nl: OutreachStrings = {
  subjectNew: (t, s) => `${t}-functie die past bij je ${s}-werk`,
  subjectGeneric: (t) => `Vacature voor ${t}`,
  subjectFollow: (t, f) => `Re: ${t}, een follow-up, ${f}`,
  salutation: (f) => `Hallo ${f},`,
  greeting: (f, s, c) =>
    c
      ? `Hallo ${f}, je werk met ${s} bij ${c} viel op.`
      : `Hallo ${f}, je werk met ${s} viel op.`,
  roleLine: (t, l, r) => `We zoeken een ${t} (${l}, ${r}).`,
  equity: "Er is een serieus aandelenbelang mogelijk.",
  whyYou: (a, b) => `Waarom jij: ${a}${b ? `. En ${b.toLowerCase()}` : ""}.`,
  cta: "Heb je zin in een vrijblijvend gesprek van 15 minuten?",
  ctaFollow: "Ik kom er nog even op terug voor het geval het is ondergesneeuwd, geen druk.",
};

const PACKS: Record<string, OutreachStrings> = { en, fr, es, de, pt, it, nl };

export function outreachStrings(lang: string): OutreachStrings {
  return PACKS[lang] ?? en;
}

/* ---- Reply-intent lexicons (merged across languages) --------------------- */

export const REPLY_LEXICON = {
  negative:
    /stop|unsubscribe|do not contact|remove me|remove my|delete my|take me off|how did you get|gdpr|leave me alone|désinscri|supprimez mes|ne me contactez|arrêtez|dar de baja|elimine mis|no me contacte|abmelden|löschen sie meine|nicht kontaktieren|cancelar inscrição|non contattarmi|verwijder mijn/i,
  ooo: /out of office|ooo|on leave|on vacation|annual leave|absent|congés|de vacaciones|fuera de la oficina|im urlaub|abwesend|de férias|in ferie|met vakantie/i,
  notInterested:
    /not interested|no thanks|happy where i am|not looking|not the right time|not for me|isn'?t for me|pass\b|pas intéressé|non merci|ce n'est pas le moment|no me interesa|no gracias|kein interesse|nicht interessiert|não tenho interesse|non interessato|geen interesse/i,
  referral:
    /refer|reach out to|you should talk to|my colleague|know someone|connect you with|je vous oriente|parlez à|mon collègue|habla con|mi colega|sprich mit|mein kollege|fale com|parla con/i,
  interested:
    /interested|yes|let's talk|sounds great|keen|love to|happy to chat|tell me when|book\b|intéressé|oui|avec plaisir|volontiers|parlons|interesado|sí|me encantaría|interessiert|ja|gerne|interessado|sim|interessato|geïnteresseerd|graag/i,
  qualified:
    /salary|comp|compensation|package|benefits|remote|relocat|visa|sponsor|equity|stack|team size|how many|what (?:is|are)|salaire|télétravail|rémunération|salario|teletrabajo|gehalt|fernarbeit|salário|stipendio|salaris/i,
};
