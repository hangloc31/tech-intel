# PRODUCT.md — Tech Intel

## Vision

One place to understand what is happening in technology right now. Answers:

* What's new? What's the tech community paying attention to? What's new in AI?
* Notable releases / products / research? How is the dev ecosystem changing?
* How is one event covered across sources? Which is the original source? Timeline?

Non-goal: a feed of thousands of meaningless headlines. **Signal > noise.**

## Users (MVP)

1. Developers / engineers checking tech daily. 2. AI practitioners tracking models/papers.
3. Tech-curious readers wanting dense, fast discovery.

## Screens (MVP → v1)

* **Home:** Top stories (clustered), Latest (chronological), Trending (velocity), Topics, Sources.
* **Story detail:** title, summary, why-it-matters (AI, optional), original source, other coverage,
  community discussion (HN/Reddit links), related stories, timeline (published vs discovered).
* **Topic:** AI / Developer / Security / Open Source… latest + trending + most-discussed.
* **Search:** full-text (+semantic later), filters: source, topic, date, author, entity.
* **Source:** profile, recent stories, health metadata (cadence, error rate).

## UX principles

Extremely fast, information-dense but readable, keyboard-friendly (`j/k`, `/`), responsive,
dark mode, clean typography, minimal chrome. Inspirations: HN speed, Google News clustering,
Techmeme density, GitHub Trending velocity — no direct UI copy.

## MVP boundary (must prove concept)

```text
RSS/Atom + HN API + GitHub
 → ingestion → normalize → dedup v1 → basic ranking → Postgres
 → read API → web feed + story detail
```

Deferred: AI enrichment (async after MVP), semantic search, X/Reddit (abstraction + mock first),
personalization, saved items/users.

## Quality bar

Every story links to original. Only headline + short summary + metadata stored/displayed.
Full content never copied. Every AI output traceable to source.
