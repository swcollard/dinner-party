import type { Attendee } from "../db/rsvps";
import { ALLERGENS, DIETS, type Need, anonymousSummary, describeNeed } from "../domain/diet";

function Choices(props: { legend: string; kind: Need["kind"]; labels: string[]; needs: Need[] }) {
  return (
    <fieldset>
      <legend>{props.legend}</legend>
      <div class="checks">
        {props.labels.map((label) => (
          <label class="check">
            <input
              type="checkbox"
              name="need"
              value={`${props.kind}:${label}`}
              checked={props.needs.some((n) => n.kind === props.kind && n.label === label)}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function NeedFields(props: { needs: Need[] }) {
  return (
    <>
      <Choices legend="Allergies" kind="allergen" labels={ALLERGENS} needs={props.needs} />
      <Choices legend="Diet" kind="diet" labels={DIETS} needs={props.needs} />
      <label>
        Anything else
        <input name="other" maxlength={200} value={props.needs.find((n) => n.kind === "other")?.label} />
      </label>
    </>
  );
}

/** Members see names; guests are outside the group, so they see only the needs. */
export function DietSummary(props: { attendees: (Attendee & { needs: Need[] })[]; showNames: boolean }) {
  const withNeeds = props.attendees.filter((a) => a.needs.length > 0);
  if (withNeeds.length === 0) return null;
  return (
    <section>
      <h2>Dietary needs</h2>
      {props.showNames ? (
        <ul>
          {withNeeds.map((a) => (
            <li>
              <strong>{a.name}{a.plus_one_of ? ` (with ${a.plus_one_of})` : ""}:</strong>{" "}
              {a.needs.map(describeNeed).join(", ")}
            </li>
          ))}
        </ul>
      ) : (
        <p>{anonymousSummary(withNeeds.map((a) => a.needs)).join(", ")}</p>
      )}
    </section>
  );
}
