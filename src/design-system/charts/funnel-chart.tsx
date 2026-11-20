export function FunnelChart({ points }: { points: readonly { stage: string; count: number }[] }) {
  const max = Math.max(...points.map((point) => point.count), 1);
  return (
    <figure className="ds-card">
      <figcaption>
        <h3>Pipeline mix</h3>
      </figcaption>
      <div className="ds-bars" aria-hidden="true">
        {points.map((point, index) => (
          <div className="ds-bar-row" key={point.stage}>
            <span>{point.stage}</span>
            <span className="ds-bar-track">
              <i className="ds-bar-fill" style={{ width: `${(point.count / max) * 100}%`, background: `var(--ds-chart-${(index % 8) + 1})` }} />
            </span>
            <span className="ds-num">{point.count}</span>
          </div>
        ))}
      </div>
      <table className="ds-sr">
        <caption>Synthetic pipeline counts</caption>
        <thead>
          <tr>
            <th scope="col">Stage</th>
            <th scope="col">People</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.stage}>
              <td>{point.stage}</td>
              <td>{point.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
