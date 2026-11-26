import type { Attendee } from "../db/rsvps";
import { type Need, RESTRICTIONS, anonymousSummary, describeNeed } from "../domain/diet";

export function NeedFields(props: { needs: Need[] }) {
  const other = props.needs.find((n) => n.kind === "other")?.label;
  return (
    <fieldset>
      <legend>Dietary restrictions</legend>
      <div class="checks">
        {RESTRICTIONS.map((need) => (
          <label class="check">
            <input
              type="checkbox"
              name="need"
              value={`${need.kind}:${need.label}`}
              checked={props.needs.some((n) => n.kind === need.kind && n.label === need.label)}
            />
            {describeNeed(need)}
          </label>
        ))}
      </div>
      <div class="other">
        <label class="check">
          <input type="checkbox" name="need" value="other" checked={other !== undefined} /> Other
        </label>
        <input name="other" aria-label="Other dietary restrictions" placeholder="Describe it" maxlength={200} value={other} />
      </div>
    </fieldset>
  );
}

/** Members see names. Guests are outside the group, so they see only the needs of people with seats. */
export function DietSummary(props: { attendees: (Attendee & { needs: Need[]; waitlisted: boolean })[]; showNames: boolean }) {
  const withNeeds = props.attendees.filter((a) => a.needs.length > 0 && (props.showNames || !a.waitlisted));
  if (withNeeds.length === 0) return null;
  return (
    <section>
      <h2>Dietary restrictions</h2>
      {props.showNames ? (
        <ul>
          {withNeeds.map((a) => (
            <li>
              <strong>{a.name}{a.plus_one_of ? ` (with ${a.plus_one_of})` : ""}{a.waitlisted ? " (waitlist)" : ""}:</strong>{" "}
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
