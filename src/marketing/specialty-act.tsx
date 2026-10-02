import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useMk } from "./mk-context";

export function SpecialtyAct() {
  const { d } = useMk();
  const [selected, setSelected] = useState(0);
  return (
    <section className="mk-section mk-specialties" aria-labelledby="mk-specialties-h">
      <div className="mk-wrap mk-specialties-grid">
        <div className="mk-specialties-copy">
          <h2 id="mk-specialties-h" className="mk-h2">{d.specialties.h2}</h2>
          <p className="mk-body">{d.specialties.p}</p>
        </div>
        <div className="mk-specialties-demo">
          <div className="mk-specialty-seg" role="group" aria-label={d.specialties.label}>
            {d.specialties.options.map((option, index) => (
              <Button
                key={option.name}
                type="button"
                variant="ghost"
                className="mk-specialty-option"
                aria-pressed={selected === index}
                onClick={() => setSelected(index)}
              >
                {option.name}
              </Button>
            ))}
          </div>
          <div className="mk-layers">
            <div className="mk-specialty-bands" aria-live="polite">
              {d.specialties.options.map((option, index) => (
                <div
                  key={option.name}
                  className={`mk-specialty-band${selected === index ? " is-selected" : ""}`}
                  aria-hidden={selected !== index}
                >
                  <strong>{d.specialties.specialtyLabel}</strong>
                  <ul>
                    {option.items.map((item) => (
                      <li key={item}>
                        <span>{item}</span>
                        <span className="mk-tag mk-tag--quiet">{d.roadmap.tag}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="mk-core-band">
              <strong>{d.specialties.coreLabel}</strong>
              <ul>
                {d.specialties.core.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}