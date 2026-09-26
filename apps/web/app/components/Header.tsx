import ThemeToggle from "./ThemeToggle";
import s from "./Header.module.css";

/**
 * App shell header: brand, global search, theme. Server component, rendered by
 * the root layout. Search targets /search so it never fights the feed's own
 * filters; the feed keeps its scoped `?q` in Filters.
 */
export default function Header() {
  return (
    <header className={s.header}>
      <div className={s.bar}>
        <a href="/" className={s.brand}>
          <span className={s.brandMark}>Tech Intel</span>
          <span className={s.brandTag}>signal &gt; noise</span>
        </a>
        <form className={s.search} method="get" action="/search" role="search">
          <span className={s.searchIcon} aria-hidden="true">
            ⌕
          </span>
          <input
            className={s.searchInput}
            type="search"
            name="q"
            placeholder="Search everything…"
            aria-label="search all stories"
          />
          <kbd className={s.searchHint} aria-hidden="true">
            /
          </kbd>
        </form>
        <span className={s.spacer} />
        <ThemeToggle />
      </div>
    </header>
  );
}
