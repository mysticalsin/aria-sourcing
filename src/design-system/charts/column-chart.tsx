export function ColumnChart({ points }: { points: readonly { day: string; count: number }[] }) {
  const max = Math.max(...points.map((point) => point.count), 1);
  return (
    <figure className="ds-card">
      <figcaption>
        <h3>Drafts approved by a person</h3>
      </figcaption>
      <div className="ds-columns" aria-hidden="true">
        {points.map((point) => (
          <div className="ds-column" key={point.day}>
            <i style={{ height: `${Math.max(4, (point.count / max) * 100)}%` }} />
            <span>
              {point.day} {point.count}
            </span>
          </div>
        ))}
      </div>
      <table className="ds-sr">
        <caption>Synthetic drafts approved each day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Drafts</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.day}>
              <td>{point.day}</td>
              <td>{point.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
