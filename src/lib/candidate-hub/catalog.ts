import type { HubRole } from "./types";

/** Featured public hubs — Java Developer mirrors the Omogen candidate-hub example. */
export const CANDIDATE_HUB_CATALOG: HubRole[] = [
  {
    slug: "developpeur-java",
    title: {
      fr: "Développeur Java",
      en: "Java Developer",
      es: "Desarrollador Java",
    },
    department: "Engineering",
    seniority: "Mid / Senior",
    employmentType: "Full-time",
    locationType: "Hybrid",
    regions: ["Paris", "Lyon", "Remote EU"],
    requiredSkills: ["Java", "Spring Boot", "SQL", "REST APIs"],
    niceToHaveSkills: ["Kafka", "Kubernetes", "AWS"],
    summary: {
      fr: "Construisez des services métier critiques avec une équipe produit Mantu. Postulez, complétez le diagnostic IA, puis initiez vous-même l'étape suivante.",
      en: "Build critical business services with a Mantu product team. Apply, complete the AI compatibility diagnostic, then self-initiate the next interview step.",
      es: "Construye servicios de negocio críticos con un equipo Mantu. Postúlate, completa el diagnóstico IA e inicia tú mismo el siguiente paso.",
    },
    linkedInSearchHint: 'Java OR "Spring Boot" ("Paris" OR Lyon) developer -recruiter',
    criteria: [
      { id: "location", weight: 15, label: { fr: "Mobilité", en: "Location fit", es: "Ubicación" } },
      { id: "visa", weight: 10, label: { fr: "Droit au travail", en: "Work authorization", es: "Autorización" } },
      { id: "experience", weight: 20, label: { fr: "Expérience Java", en: "Java experience", es: "Experiencia Java" } },
      { id: "core_skills", weight: 25, label: { fr: "Spring / API", en: "Spring / APIs", es: "Spring / APIs" } },
      { id: "tools", weight: 10, label: { fr: "Outils", en: "Tooling", es: "Herramientas" } },
      { id: "language", weight: 10, label: { fr: "Langues", en: "Languages", es: "Idiomas" } },
      { id: "availability", weight: 10, label: { fr: "Disponibilité", en: "Availability", es: "Disponibilidad" } },
    ],
    questions: [
      {
        id: "q_location",
        kind: "choice",
        criterionId: "location",
        prompt: {
          fr: "Pouvez-vous travailler depuis Paris, Lyon, ou en remote UE ?",
          en: "Can you work from Paris, Lyon, or remote EU?",
          es: "¿Puede trabajar desde París, Lyon o en remoto UE?",
        },
        choices: [
          { value: "yes", label: { fr: "Oui", en: "Yes", es: "Sí" } },
          { value: "relocate", label: { fr: "Oui, avec relocalisation", en: "Yes, with relocation", es: "Sí, con reubicación" } },
          { value: "no", label: { fr: "Non", en: "No", es: "No" } },
        ],
      },
      {
        id: "q_visa",
        kind: "yesno",
        criterionId: "visa",
        prompt: {
          fr: "Avez-vous besoin d'un visa / sponsorship pour travailler en UE ?",
          en: "Do you need visa sponsorship to work in the EU?",
          es: "¿Necesita sponsorship de visado para trabajar en la UE?",
        },
      },
      {
        id: "q_java_years",
        kind: "choice",
        criterionId: "experience",
        prompt: {
          fr: "Combien d'années d'expérience Java professionnelle ?",
          en: "Years of professional Java experience?",
          es: "¿Años de experiencia profesional en Java?",
        },
        choices: [
          { value: "0-2", label: { fr: "0–2 ans", en: "0–2 years", es: "0–2 años" } },
          { value: "3-5", label: { fr: "3–5 ans", en: "3–5 years", es: "3–5 años" } },
          { value: "6+", label: { fr: "6+ ans", en: "6+ years", es: "6+ años" } },
        ],
      },
      {
        id: "q_spring",
        kind: "stars",
        criterionId: "core_skills",
        prompt: {
          fr: "Notez votre maîtrise Spring Boot / APIs REST (1–5).",
          en: "Rate your Spring Boot / REST API mastery (1–5).",
          es: "Valore su dominio de Spring Boot / APIs REST (1–5).",
        },
      },
      {
        id: "q_tools",
        kind: "stars",
        criterionId: "tools",
        prompt: {
          fr: "Notez votre aisance SQL / Git / CI (1–5).",
          en: "Rate your SQL / Git / CI comfort (1–5).",
          es: "Valore su soltura con SQL / Git / CI (1–5).",
        },
      },
      {
        id: "q_lang",
        kind: "choice",
        criterionId: "language",
        prompt: {
          fr: "Niveau d'anglais pour travailler en équipe internationale ?",
          en: "English level for an international team?",
          es: "¿Nivel de inglés para un equipo internacional?",
        },
        choices: [
          { value: "a2", label: { fr: "A2 / débutant", en: "A2 / beginner", es: "A2 / principiante" } },
          { value: "b1", label: { fr: "B1", en: "B1", es: "B1" } },
          { value: "b2", label: { fr: "B2+", en: "B2+", es: "B2+" } },
          { value: "c1", label: { fr: "C1 / natif", en: "C1 / fluent", es: "C1 / fluido" } },
        ],
      },
      {
        id: "q_avail",
        kind: "choice",
        criterionId: "availability",
        prompt: {
          fr: "Disponibilité pour démarrer ?",
          en: "When can you start?",
          es: "¿Cuándo puede empezar?",
        },
        choices: [
          { value: "immediate", label: { fr: "Immédiatement", en: "Immediately", es: "Inmediatamente" } },
          { value: "1m", label: { fr: "Sous 1 mois", en: "Within 1 month", es: "En 1 mes" } },
          { value: "3m", label: { fr: "1–3 mois", en: "1–3 months", es: "1–3 meses" } },
          { value: "later", label: { fr: "Plus tard", en: "Later", es: "Más adelante" } },
        ],
      },
    ],
  },
  {
    slug: "product-manager",
    title: {
      fr: "Product Manager",
      en: "Product Manager",
      es: "Product Manager",
    },
    department: "Product",
    seniority: "Senior",
    employmentType: "Full-time",
    locationType: "Hybrid",
    regions: ["Paris", "Remote EU"],
    requiredSkills: ["Roadmapping", "Discovery", "Stakeholder management"],
    niceToHaveSkills: ["B2B SaaS", "SQL"],
    summary: {
      fr: "Pilotez des parcours recrutement IA pour des clients enterprise.",
      en: "Own AI recruiting journeys for enterprise clients.",
      es: "Lidere journeys de recruiting IA para clientes enterprise.",
    },
    linkedInSearchHint: '"Product Manager" (SaaS OR B2B) Paris OR Remote',
    criteria: [
      { id: "location", weight: 15, label: { fr: "Mobilité", en: "Location fit", es: "Ubicación" } },
      { id: "visa", weight: 10, label: { fr: "Droit au travail", en: "Work authorization", es: "Autorización" } },
      { id: "experience", weight: 25, label: { fr: "Expérience PM", en: "PM experience", es: "Experiencia PM" } },
      { id: "core_skills", weight: 25, label: { fr: "Discovery / delivery", en: "Discovery / delivery", es: "Discovery / delivery" } },
      { id: "tools", weight: 5, label: { fr: "Outils", en: "Tooling", es: "Herramientas" } },
      { id: "language", weight: 10, label: { fr: "Langues", en: "Languages", es: "Idiomas" } },
      { id: "availability", weight: 10, label: { fr: "Disponibilité", en: "Availability", es: "Disponibilidad" } },
    ],
    questions: [
      {
        id: "q_location",
        kind: "choice",
        criterionId: "location",
        prompt: {
          fr: "Paris hybrid ou remote UE vous convient ?",
          en: "Is Paris hybrid or remote EU workable?",
          es: "¿Le funciona París híbrido o remoto UE?",
        },
        choices: [
          { value: "yes", label: { fr: "Oui", en: "Yes", es: "Sí" } },
          { value: "relocate", label: { fr: "Avec relocalisation", en: "With relocation", es: "Con reubicación" } },
          { value: "no", label: { fr: "Non", en: "No", es: "No" } },
        ],
      },
      {
        id: "q_visa",
        kind: "yesno",
        criterionId: "visa",
        prompt: {
          fr: "Avez-vous besoin d'un sponsorship visa ?",
          en: "Do you need visa sponsorship?",
          es: "¿Necesita sponsorship de visado?",
        },
      },
      {
        id: "q_pm_years",
        kind: "choice",
        criterionId: "experience",
        prompt: {
          fr: "Années en product management ?",
          en: "Years in product management?",
          es: "¿Años en product management?",
        },
        choices: [
          { value: "0-2", label: { fr: "0–2", en: "0–2", es: "0–2" } },
          { value: "3-5", label: { fr: "3–5", en: "3–5", es: "3–5" } },
          { value: "6+", label: { fr: "6+", en: "6+", es: "6+" } },
        ],
      },
      {
        id: "q_discovery",
        kind: "stars",
        criterionId: "core_skills",
        prompt: {
          fr: "Maîtrise discovery + delivery (1–5)",
          en: "Discovery + delivery mastery (1–5)",
          es: "Dominio discovery + delivery (1–5)",
        },
      },
      {
        id: "q_tools",
        kind: "stars",
        criterionId: "tools",
        prompt: {
          fr: "Aisance analytics / SQL (1–5)",
          en: "Analytics / SQL comfort (1–5)",
          es: "Soltura analytics / SQL (1–5)",
        },
      },
      {
        id: "q_lang",
        kind: "choice",
        criterionId: "language",
        prompt: {
          fr: "Niveau d'anglais",
          en: "English level",
          es: "Nivel de inglés",
        },
        choices: [
          { value: "a2", label: { fr: "A2", en: "A2", es: "A2" } },
          { value: "b1", label: { fr: "B1", en: "B1", es: "B1" } },
          { value: "b2", label: { fr: "B2+", en: "B2+", es: "B2+" } },
          { value: "c1", label: { fr: "C1", en: "C1", es: "C1" } },
        ],
      },
      {
        id: "q_avail",
        kind: "choice",
        criterionId: "availability",
        prompt: {
          fr: "Disponibilité",
          en: "Availability",
          es: "Disponibilidad",
        },
        choices: [
          { value: "immediate", label: { fr: "Immédiat", en: "Immediate", es: "Inmediato" } },
          { value: "1m", label: { fr: "1 mois", en: "1 month", es: "1 mes" } },
          { value: "3m", label: { fr: "1–3 mois", en: "1–3 months", es: "1–3 meses" } },
          { value: "later", label: { fr: "Plus tard", en: "Later", es: "Más adelante" } },
        ],
      },
    ],
  },
];

export function getHubRole(slug: string): HubRole | null {
  const normalized = slug.trim().toLowerCase();
  return CANDIDATE_HUB_CATALOG.find((role) => role.slug === normalized) ?? null;
}

export function listHubRoles(): HubRole[] {
  return CANDIDATE_HUB_CATALOG;
}
