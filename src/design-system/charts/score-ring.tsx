export function ScoreRing({ score, name }: { score: number; name: string }) {
  const bounded = Math.max(0, Math.min(100, score));
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dash = (bounded / 100) * circumference;
  return (
    <figure className="ds-card">
      <figcaption>
        <h3>Suggestion score</h3>
      </figcaption>
      <div className="ds-ring-wrap">
        <svg className="ds-ring" viewBox="0 0 120 120" role="img" aria-label={`${name}, suggestion ${bounded} out of 100. Not a hiring decision.`}>
          <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--ds-line)" strokeOpacity="0.35" strokeWidth="8" />
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke="var(--ds-chart-1)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform="rotate(-90 60 60)"
          />
          <text x="60" y="58" textAnchor="middle" fontSize="28" fontWeight="700">
            {bounded}
          </text>
          <text x="60" y="76" textAnchor="middle" fontSize="10">
            out of 100
          </text>
        </svg>
        <div>
          <p>{name}</p>
          <p className="ds-muted">Suggestion only. Aria does not reject and does not decide.</p>
        </div>
      </div>
    </figure>
  );
}
