import ui from "./components/ui.module.css";

export default function NotFound() {
  return (
    <section className={ui.empty}>
      <h1 style={{ fontSize: 18, margin: "0 0 6px", color: "var(--text)" }}>Not found</h1>
      <p style={{ margin: 0 }}>This story does not exist (anymore).</p>
      <p style={{ margin: "12px 0 0" }}>
        <a href="/">← back to feed</a>
      </p>
    </section>
  );
}
