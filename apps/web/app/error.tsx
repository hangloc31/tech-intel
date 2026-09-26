"use client";

import ui from "./components/ui.module.css";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className={ui.alert} role="alert">
      <p style={{ margin: "0 0 10px" }}>Something went wrong loading this page.</p>
      <button type="button" onClick={reset} className={ui.btn}>
        Try again
      </button>
    </section>
  );
}
