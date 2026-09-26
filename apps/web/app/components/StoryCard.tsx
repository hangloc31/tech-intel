import { timeAgo, topicColor } from "../../lib/format";
import type { StoryCard as StoryCardType } from "../../lib/stories";
import SourceIcon from "./SourceIcon";
import Thumb from "./Thumb";
import s from "./StoryCard.module.css";
import ui from "./ui.module.css";

function Meta({ story, showTopics = true }: { story: StoryCardType; showTopics?: boolean }) {
  const origin = story.member_sources[0] ?? story.original_source_id;
  return (
    <p className={s.meta}>
      {/* Only worth showing once more than one outlet carries the story. */}
      {story.source_count > 1 && (
        <span className={ui.badgeAccent} title={`${story.source_count} outlets are covering this`}>
          {story.source_count} outlets
        </span>
      )}
      {origin && <SourceIcon articleUrl={story.origin_url ?? ""} source={origin} />}
      {showTopics &&
        story.topics.slice(0, 3).map((t) => (
          <span key={t} className={ui.badge}>
            <span className={ui.dot} style={{ background: topicColor(t) }} />
            {t}
          </span>
        ))}
      <time dateTime={story.first_seen_at} title={story.first_seen_at}>
        {timeAgo(story.first_seen_at)}
      </time>
    </p>
  );
}

/**
 * Lead-story variant: only used when the story actually has artwork, since ~95%
 * of items have none and an empty hero frame looks broken rather than bold.
 */
export function StoryHero({ story }: { story: StoryCardType }) {
  return (
    <a data-story href={`/story/${story.id}`} className={s.hero}>
      <span className={s.heroMedia}>
        <Thumb src={story.image_url} alt="" fill />
      </span>
      <span className={s.heroBody}>
        <span className={s.heroKicker}>Lead story</span>
        <h2 className={s.heroTitle}>{story.title}</h2>
        {story.summary && <p className={s.heroSummary}>{story.summary}</p>}
        <Meta story={story} />
      </span>
    </a>
  );
}

/** Dense row. Default for everything without artwork. */
export default function StoryCard({ story, rank }: { story: StoryCardType; rank?: number }) {
  return (
    <article className={s.row}>
      {rank !== undefined && (
        <span className={s.rank} aria-hidden="true">
          {rank}
        </span>
      )}
      {story.image_url && (
        <span className={s.thumb}>
          <Thumb src={story.image_url} alt="" size={112} />
        </span>
      )}
      <div className={s.body}>
        <h2 className={s.title}>
          <a data-story href={`/story/${story.id}`}>
            {story.title}
          </a>
        </h2>
        {story.summary && <p className={s.summary}>{story.summary}</p>}
        <Meta story={story} />
      </div>
    </article>
  );
}
