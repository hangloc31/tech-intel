"use client";

import { useState } from "react";
import s from "./Thumb.module.css";

/**
 * Thumbnail that hides itself when missing or broken (per design: no placeholders).
 * `fill` stretches to the parent box (hero/cover); otherwise a fixed size is used.
 */
export default function Thumb({
  src,
  alt,
  size = 120,
  fill = false,
}: {
  src: string | null;
  alt: string;
  size?: number;
  fill?: boolean;
}) {
  const [dead, setDead] = useState(false);
  if (!src || dead) return null;
  const common = {
    src,
    alt,
    loading: "lazy" as const,
    decoding: "async" as const,
    referrerPolicy: "no-referrer" as const,
    onError: () => setDead(true),
  };
  if (fill) return <img {...common} className={s.fill} />;
  return (
    <img
      {...common}
      width={size}
      height={Math.round(size * 0.66)}
      style={{ width: size, height: Math.round(size * 0.66), objectFit: "cover", borderRadius: 6, flexShrink: 0 }}
    />
  );
}
