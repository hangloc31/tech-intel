"use client";

import { useState } from "react";
import { faviconUrl } from "../../lib/format";
import s from "./StoryCard.module.css";
import ui from "./ui.module.css";

/**
 * Favicon + source name. The favicon service 404s for obscure domains, and this
 * used to leave a broken-image icon on every affected card (this component was
 * server-rendered, so there was no way to recover). Now a failed load falls back
 * to the source's initial letter.
 */
export default function SourceIcon({ articleUrl, source }: { articleUrl: string; source: string }) {
  const [dead, setDead] = useState(false);
  const icon = faviconUrl(articleUrl);
  if (!icon || dead) {
    return (
      <span className={s.source}>
        <span className={ui.initial} aria-hidden="true">
          {source.charAt(0).toUpperCase()}
        </span>
        {source}
      </span>
    );
  }
  return (
    <span className={s.source}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={icon}
        alt=""
        width={13}
        height={13}
        loading="lazy"
        onError={() => setDead(true)}
        className={ui.favicon}
      />
      {source}
    </span>
  );
}
