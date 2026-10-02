import { Lock, Plus } from "lucide-react";
import type { CSSProperties } from "react";
import { fill } from "../i18n";
import { useMk } from "../mk-context";
import type { KeyringView } from "./keyring-model";

export function KeyringWindow({ view }: { view: KeyringView }) {
  const { d } = useMk();
  const k = d.keyring;
  const open = view.rows.find((r) => r.patient.file === view.openFile)?.patient ?? null;
  const shown = open ?? view.rows[1]!.patient;

  return (
    <div className={`mk-win${view.refused ? " is-refused" : ""}`}>
      <div className="mk-win-bar">
        <span className="mk-win-clinic">{k.clinic}</span>
        <span className="mk-tag">{k.sample}</span>
      </div>
      <div className="mk-win-body">
        <ul className="mk-win-side" aria-label={k.side.overview}>
          {view.sidebar.map((item) => (
            <li key={item} className={item === "patients" ? "is-active" : undefined}>
              {k.side[item]}
            </li>
          ))}
        </ul>
        <div className="mk-win-main">
          <div className="mk-win-area">
            <div className="mk-win-head">
              <strong>{k.side.patients}</strong>
              {view.buttons.create && (
                <span className="mk-win-btn mk-win-btn--primary">
                  <Plus size={14} aria-hidden="true" />
                  {k.newPatient}
                </span>
              )}
            </div>
            <table className="mk-win-table">
              <thead>
                <tr>
                  <th scope="col">{k.cols.file}</th>
                  <th scope="col">{k.cols.name}</th>
                  <th scope="col">{k.cols.branch}</th>
                  <th scope="col">{k.cols.phone}</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map(({ patient, visible }, i) => (
                  <tr
                    key={patient.file}
                    className={`${visible ? "" : "is-frost"}${patient.file === view.openFile ? " is-open" : ""}`}
                    style={{ "--i": i } as CSSProperties}
                  >
                    <td className="mk-num">{patient.file}</td>
                    <td>{k.patients[patient.index]}</td>
                    <td>{k.branches[patient.branch]}</td>
                    <td className="mk-num" dir="ltr">{patient.phone}</td>
                    {!visible && (
                      <td className="mk-win-outside" aria-hidden={view.refused}>
                        {k.outside}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={`mk-win-file${open ? "" : " is-frost"}`}>
              <div>
                <strong>{fill(k.fileTitle, { file: shown.file })}</strong>
                <span>{k.patients[shown.index]} · {k.branches[shown.branch]}</span>
              </div>
              <div className="mk-win-actions">
                {view.buttons.update && <span className="mk-win-btn">{k.edit}</span>}
                {view.buttons.deactivate && <span className="mk-win-btn">{k.archive}</span>}
              </div>
            </div>
          </div>
          {view.refused && (
            <div className="mk-stamp" role="status">
              <Lock size={18} aria-hidden="true" />
              <strong>{k.refusedTitle}</strong>
              <span>{k.refusedBody}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
