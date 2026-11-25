import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import type { Actor } from "../types";

export function Layout(props: { title: string; actor?: Actor | null; forgetPath?: string; children: Child }) {
  return (
    <>
    {raw("<!DOCTYPE html>")}
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>{props.title}</title>
        <link rel="stylesheet" href="/styles.css" />
        <script src="/app.js" defer></script>
      </head>
      <body>
        {props.actor && (
          <header>
            {props.actor.scope === "full" ? <a href="/">Dinners</a> : <span>Dinner invite</span>}
            <form method="post" action={props.forgetPath ?? "/forget"}>
              <span>You're {props.actor.person.name}</span>
              <button class="link">Not you?</button>
            </form>
          </header>
        )}
        <main>{props.children}</main>
      </body>
    </html>
    </>
  );
}

/** Identical for every URL, so it reveals nothing to strangers or link previews. */
export function NeutralPage() {
  return (
    <Layout title="Open your personal link">
      <h1>Open your personal link</h1>
      <p>This browser doesn't recognize you yet. Open the link you were sent, then try again.</p>
      <p>Can't find it? Ask whoever sent you here to send it again.</p>
    </Layout>
  );
}

export function ErrorPage(props: { actor: Actor | null; message: string; back: string }) {
  return (
    <Layout title="Something needs fixing" actor={props.actor}>
      <h1>Something needs fixing</h1>
      <p role="alert">{props.message}</p>
      <p><a class="button" href={props.back}>Go back</a></p>
    </Layout>
  );
}

export function Field(props: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  value?: string;
  autocomplete?: string;
}) {
  return (
    <label>
      {props.label}
      <input
        name={props.name}
        type={props.type ?? "text"}
        required={props.required}
        value={props.value}
        autocomplete={props.autocomplete ?? "off"}
      />
    </label>
  );
}
