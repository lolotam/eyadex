import { useMk } from "./mk-context";

export function RoadmapAct() {
  const { d } = useMk();
  return (
    <section className="mk-section mk-roadmap" aria-labelledby="mk-road-h">
      <div className="mk-wrap mk-roadmap-grid">
        <div>
          <h2 id="mk-road-h" className="mk-h2">
            {d.roadmap.h2}
          </h2>
          <p className="mk-body">{d.roadmap.p}</p>
        </div>
        <ul className="mk-road-list">
          {d.roadmap.items.map((item) => (
            <li key={item}>
              <span>{item}</span>
              <span className="mk-tag mk-tag--quiet">{d.roadmap.tag}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
