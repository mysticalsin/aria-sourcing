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

/** ~60 ISO 639-1 business languages for Mantu markets (EU, MENA, APAC, Americas). */
export const BUSINESS_LANGUAGE_CATALOG: Language[] = [
  ...LANGUAGES,
  { code: "ar", label: "Arabic", native: "العربية" },
  { code: "zh", label: "Chinese", native: "中文" },
  { code: "ja", label: "Japanese", native: "日本語" },
  { code: "ko", label: "Korean", native: "한국어" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "ru", label: "Russian", native: "Русский" },
  { code: "pl", label: "Polish", native: "Polski" },
  { code: "tr", label: "Turkish", native: "Türkçe" },
  { code: "sv", label: "Swedish", native: "Svenska" },
  { code: "da", label: "Danish", native: "Dansk" },
  { code: "no", label: "Norwegian", native: "Norsk" },
  { code: "fi", label: "Finnish", native: "Suomi" },
  { code: "cs", label: "Czech", native: "Čeština" },
  { code: "sk", label: "Slovak", native: "Slovenčina" },
  { code: "hu", label: "Hungarian", native: "Magyar" },
  { code: "ro", label: "Romanian", native: "Română" },
  { code: "bg", label: "Bulgarian", native: "Български" },
  { code: "el", label: "Greek", native: "Ελληνικά" },
  { code: "he", label: "Hebrew", native: "עברית" },
  { code: "id", label: "Indonesian", native: "Bahasa Indonesia" },
  { code: "ms", label: "Malay", native: "Bahasa Melayu" },
  { code: "th", label: "Thai", native: "ไทย" },
  { code: "vi", label: "Vietnamese", native: "Tiếng Việt" },
  { code: "uk", label: "Ukrainian", native: "Українська" },
  { code: "hr", label: "Croatian", native: "Hrvatski" },
  { code: "sr", label: "Serbian", native: "Српски" },
  { code: "sl", label: "Slovenian", native: "Slovenščina" },
  { code: "lt", label: "Lithuanian", native: "Lietuvių" },
  { code: "lv", label: "Latvian", native: "Latviešu" },
  { code: "et", label: "Estonian", native: "Eesti" },
  { code: "ca", label: "Catalan", native: "Català" },
  { code: "eu", label: "Basque", native: "Euskara" },
  { code: "gl", label: "Galician", native: "Galego" },
  { code: "fa", label: "Persian", native: "فارسی" },
  { code: "ur", label: "Urdu", native: "اردو" },
  { code: "bn", label: "Bengali", native: "বাংলা" },
  { code: "ta", label: "Tamil", native: "தமிழ்" },
  { code: "te", label: "Telugu", native: "తెలుగు" },
  { code: "mr", label: "Marathi", native: "मराठी" },
  { code: "gu", label: "Gujarati", native: "ગુજરાતી" },
  { code: "kn", label: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ml", label: "Malayalam", native: "മലയാളം" },
  { code: "pa", label: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "sw", label: "Swahili", native: "Kiswahili" },
  { code: "af", label: "Afrikaans", native: "Afrikaans" },
  { code: "sq", label: "Albanian", native: "Shqip" },
  { code: "mk", label: "Macedonian", native: "Македонски" },
  { code: "is", label: "Icelandic", native: "Íslenska" },
  { code: "ga", label: "Irish", native: "Gaeilge" },
  { code: "cy", label: "Welsh", native: "Cymraeg" },
  { code: "mt", label: "Maltese", native: "Malti" },
  { code: "lb", label: "Luxembourgish", native: "Lëtzebuergesch" },
  { code: "be", label: "Belarusian", native: "Беларуская" },
  { code: "ka", label: "Georgian", native: "ქართული" },
  { code: "hy", label: "Armenian", native: "Հայերեն" },
  { code: "az", label: "Azerbaijani", native: "Azərbaycan" },
  { code: "kk", label: "Kazakh", native: "Қазақ" },
  { code: "uz", label: "Uzbek", native: "Oʻzbek" },
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
  { code: "ar", re: /[\u0600-\u06ff]/ },
  { code: "ja", re: /[\u3040-\u30ff\u4e00-\u9faf]/ },
  { code: "zh", re: /[\u4e00-\u9fff]/ },
  { code: "ko", re: /[\uac00-\ud7af]/ },
  { code: "ru", re: /\b(привет|спасибо|да|нет|компания|работа)\b/i },
  { code: "pl", re: /\b(cześć|dziękuję|firma|stanowisko|tak|nie)\b/i },
  { code: "tr", re: /\b(merhaba|teşekkür|evet|hayır|şirket|pozisyon)\b/i },
  { code: "sv", re: /\b(hej|tack|företag|tjänst|ja|nej)\b/i },
  { code: "hi", re: /[\u0900-\u097f]/ },
];

export function isKnownBusinessLanguage(code: string): boolean {
  return BUSINESS_LANGUAGE_CATALOG.some((l) => l.code === code);
}

/** Fast lexicon detection; Hermes classify task handles the long tail when configured. */
export function detectLanguageWithHint(text: string, preferred?: string): string {
  const pref = preferred?.trim();
  if (pref && isKnownBusinessLanguage(pref)) return pref;
  return detectLanguage(text);
}

/** Heuristic detection with a hint when Hermes should refine ambiguous non-Latin text. */
export function detectLanguageWithHermes(
  text: string,
  preferred?: string,
): { code: string; hermesHint: boolean } {
  const pref = preferred?.trim();
  if (pref && isKnownBusinessLanguage(pref)) {
    return { code: pref.slice(0, 2), hermesHint: false };
  }
  const code = detectLanguage(text);
  const trimmed = text.trim();
  const hermesHint =
    code === "en"
    && trimmed.length > 24
    && /[^\x00-\x7f]/.test(trimmed);
  return { code, hermesHint };
}

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
  subjectGeneric: (t) => `${t} opportunity at Mantu`,
  subjectFollow: (t, f) => `Re: ${t} (follow-up), ${f}`,
  salutation: (f) => `Hi ${f},`,
  greeting: (f, s, c) =>
    c
      ? `Hi ${f}, your work with ${s} at ${c} stood out - I wanted to reach out personally.`
      : `Hi ${f}, your work with ${s} stood out - I wanted to reach out personally.`,
  roleLine: (t, l, r) =>
    `Mantu Group is hiring a ${t} (${l}, ${r}). We are a global consulting group that helps clients transform through technology and talent.`,
  equity: "Meaningful equity is on the table.",
  whyYou: (a, b) =>
    `What stood out for me: ${a}${b ? `. Also ${b.toLowerCase()}` : ""}.`,
  cta: "Would you be open to a short, no-pressure conversation to see if there is mutual fit?",
  ctaFollow: "Circling back once in case this slipped - no pressure either way.",
};

const fr: OutreachStrings = {
  subjectNew: (t, s) => `Poste de ${t} en lien avec votre expérience ${s}`,
  subjectGeneric: (t) => `Opportunité de ${t} chez Mantu`,
  subjectFollow: (t, f) => `Re : ${t}, petite relance, ${f}`,
  salutation: (f) => `Bonjour ${f},`,
  greeting: (f, s, c) =>
    c
      ? `Bonjour ${f}, votre travail sur ${s} chez ${c} a retenu mon attention - je souhaitais vous écrire personnellement.`
      : `Bonjour ${f}, votre travail sur ${s} a retenu mon attention - je souhaitais vous écrire personnellement.`,
  roleLine: (t, l, r) =>
    `Mantu Group recrute un(e) ${t} (${l}, ${r}). Nous sommes un groupe de conseil international qui aide ses clients à se transformer grâce à la technologie et aux talents.`,
  equity: "Un intéressement au capital est prévu.",
  whyYou: (a, b) =>
    `Ce qui m'a marqué : ${a}${b ? `. Et aussi ${b.toLowerCase()}` : ""}.`,
  cta: "Seriez-vous ouvert(e) à un échange court, sans engagement, pour voir s'il y a un intérêt mutuel ?",
  ctaFollow: "Je reviens vers vous au cas où, sans aucune pression.",
};

const es: OutreachStrings = {
  subjectNew: (t, s) => `Puesto de ${t} acorde con tu experiencia en ${s}`,
  subjectGeneric: (t) => `Oportunidad de ${t} en Mantu`,
  subjectFollow: (t, f) => `Re: ${t}, un seguimiento, ${f}`,
  salutation: (f) => `Hola ${f},`,
  greeting: (f, s, c) =>
    c
      ? `Hola ${f}, tu trabajo con ${s} en ${c} me llamó la atención - quería escribirte en persona.`
      : `Hola ${f}, tu trabajo con ${s} me llamó la atención - quería escribirte en persona.`,
  roleLine: (t, l, r) =>
    `Mantu Group busca un/a ${t} (${l}, ${r}). Somos un grupo de consultoría global que ayuda a clientes a transformarse con tecnología y talento.`,
  equity: "Hay participación accionarial sobre la mesa.",
  whyYou: (a, b) =>
    `Lo que destacó para mí: ${a}${b ? `. También ${b.toLowerCase()}` : ""}.`,
  cta: "¿Te vendría bien una conversación breve, sin compromiso, para ver si hay encaje mutuo?",
  ctaFollow: "Vuelvo a escribirte por si se traspapeló, sin ninguna presión.",
};

const de: OutreachStrings = {
  subjectNew: (t, s) => `${t}-Stelle, die zu deiner ${s}-Erfahrung passt`,
  subjectGeneric: (t) => `Position als ${t} bei Mantu`,
  subjectFollow: (t, f) => `Re: ${t}, kurze Nachfrage, ${f}`,
  salutation: (f) => `Hallo ${f},`,
  greeting: (f, s, c) =>
    c
      ? `Hallo ${f}, deine Arbeit mit ${s} bei ${c} ist mir aufgefallen - ich wollte dich persönlich erreichen.`
      : `Hallo ${f}, deine Arbeit mit ${s} ist mir aufgefallen - ich wollte dich persönlich erreichen.`,
  roleLine: (t, l, r) =>
    `Mantu Group sucht eine/n ${t} (${l}, ${r}). Wir sind eine globale Beratungsgruppe, die Kunden mit Technologie und Talent bei der Transformation unterstützt.`,
  equity: "Eine sinnvolle Beteiligung ist möglich.",
  whyYou: (a, b) =>
    `Was mir aufgefallen ist: ${a}${b ? `. Außerdem ${b.toLowerCase()}` : ""}.`,
  cta: "Hättest du Lust auf ein kurzes, unverbindliches Gespräch, um zu sehen, ob es passt?",
  ctaFollow: "Ich melde mich nochmal, falls es untergegangen ist, ganz ohne Druck.",
};

const pt: OutreachStrings = {
  subjectNew: (t, s) => `Vaga de ${t} alinhada à sua experiência em ${s}`,
  subjectGeneric: (t) => `Oportunidade para ${t} na Mantu`,
  subjectFollow: (t, f) => `Re: ${t}, um retorno, ${f}`,
  salutation: (f) => `Olá ${f},`,
  greeting: (f, s, c) =>
    c
      ? `Olá ${f}, o seu trabalho com ${s} na ${c} chamou a atenção - quis escrever-lhe pessoalmente.`
      : `Olá ${f}, o seu trabalho com ${s} chamou a atenção - quis escrever-lhe pessoalmente.`,
  roleLine: (t, l, r) =>
    `Mantu Group está a contratar um(a) ${t} (${l}, ${r}). Somos um grupo de consultoria global que ajuda clientes a transformar-se com tecnologia e talento.`,
  equity: "Há participação societária em jogo.",
  whyYou: (a, b) =>
    `O que me chamou a atenção: ${a}${b ? `. Também ${b.toLowerCase()}` : ""}.`,
  cta: "Estaria aberto(a) a uma conversa breve, sem compromisso, para ver se há encaixe mútuo?",
  ctaFollow: "Retomo o contato caso tenha passado, sem qualquer pressão.",
};

const it: OutreachStrings = {
  subjectNew: (t, s) => `Posizione ${t} in linea con la tua esperienza in ${s}`,
  subjectGeneric: (t) => `Opportunità come ${t} in Mantu`,
  subjectFollow: (t, f) => `Re: ${t}, un promemoria, ${f}`,
  salutation: (f) => `Ciao ${f},`,
  greeting: (f, s, c) =>
    c
      ? `Ciao ${f}, il tuo lavoro con ${s} in ${c} ha colpito - volevo scriverti di persona.`
      : `Ciao ${f}, il tuo lavoro con ${s} ha colpito - volevo scriverti di persona.`,
  roleLine: (t, l, r) =>
    `Mantu Group cerca un/una ${t} (${l}, ${r}). Siamo un gruppo di consulenza globale che aiuta i clienti a trasformarsi con tecnologia e talento.`,
  equity: "È prevista una partecipazione azionaria.",
  whyYou: (a, b) =>
    `Cosa mi ha colpito: ${a}${b ? `. Anche ${b.toLowerCase()}` : ""}.`,
  cta: "Ti andrebbe una breve conversazione, senza impegno, per capire se c'è interesse reciproco?",
  ctaFollow: "Ti riscrivo nel caso fosse sfuggito, senza alcuna pressione.",
};

const nl: OutreachStrings = {
  subjectNew: (t, s) => `${t}-functie die past bij je ${s}-werk`,
  subjectGeneric: (t) => `Vacature voor ${t} bij Mantu`,
  subjectFollow: (t, f) => `Re: ${t}, een follow-up, ${f}`,
  salutation: (f) => `Hallo ${f},`,
  greeting: (f, s, c) =>
    c
      ? `Hallo ${f}, je werk met ${s} bij ${c} viel op - ik wilde je persoonlijk bereiken.`
      : `Hallo ${f}, je werk met ${s} viel op - ik wilde je persoonlijk bereiken.`,
  roleLine: (t, l, r) =>
    `Mantu Group zoekt een ${t} (${l}, ${r}). Wij zijn een wereldwijde consultancygroep die klanten helpt transformeren met technologie en talent.`,
  equity: "Er is een serieus aandelenbelang mogelijk.",
  whyYou: (a, b) =>
    `Wat mij opviel: ${a}${b ? `. Ook ${b.toLowerCase()}` : ""}.`,
  cta: "Heb je zin in een kort, vrijblijvend gesprek om te zien of er wederzijdse interesse is?",
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
