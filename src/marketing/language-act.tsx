import { useState } from "react";
import { mkDicts, type MkLang } from "./i18n";
import { useMk } from "./mk-context";

export function LanguageAct() {
  const { d, lang } = useMk();
  const [sample, setSample] = useState<MkLang>(lang);
  const t = mkDicts[sample].language.table;
  return (
    <section className="mk-section mk-language" aria-labelledby="mk-lang-h">
      <div className="mk-wrap mk-language-grid">
        <div>
          <h2 id="mk-lang-h" className="mk-h2">
            {d.language.h2}
          </h2>
          <p className="mk-body">{d.language.p}</p>
        </div>
        <div>
          <div className="mk-seg" role="group" aria-label={d.language.toggleLabel}>
            {(["ar", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                lang={l}
                aria-pressed={sample === l}
                onClick={() => setSample(l)}
              >
                {mkDicts[l].language.self}
              </button>
            ))}
          </div>
          <div
            key={sample}
            className="mk-sample"
            dir={sample === "ar" ? "rtl" : "ltr"}
            lang={sample}
          >
            <div className="mk-sample-head">
              <strong>{t.title}</strong>
              <span className="mk-tag">{mkDicts[sample].keyring.sample}</span>
            </div>
            <table className="mk-win-table">
              <thead>
                <tr>
                  <th scope="col">{t.cols.name}</th>
                  <th scope="col">{t.cols.phone}</th>
                  <th scope="col">{t.cols.status}</th>
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td className="mk-num" dir="ltr">
                      {r.phone}
                    </td>
                    <td>
                      <span className="mk-status">{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
