import s from "./components/Shell.module.css";
import side from "./components/Sidebar.module.css";
import ui from "./components/ui.module.css";

/** Skeleton that mirrors the feed's real geometry, so the swap does not jump. */
export default function Loading() {
  return (
    <div className={s.columns} role="status" aria-label="Loading stories">
      <div className={s.main}>
        <p className={ui.skeleton} style={{ width: 220, height: 28, marginBottom: 20 }} />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} style={{ padding: "10px 12px" }}>
            <p className={ui.skeletonTitle} />
            <p className={ui.skeleton} style={{ marginTop: 8, width: "88%" }} />
            <p className={ui.skeleton} style={{ marginTop: 6, width: "40%" }} />
          </div>
        ))}
      </div>
      <div className={side.rail}>
        <div className={side.card}>
          <p className={ui.skeleton} style={{ width: "50%", marginBottom: 12 }} />
          <p className={ui.skeleton} style={{ width: "100%" }} />
          <p className={ui.skeleton} style={{ width: "100%", marginTop: 8 }} />
        </div>
      </div>
    </div>
  );
}
