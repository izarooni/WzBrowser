import { useEffect, useState } from "react";

/** A row another tab asked to show. A new object each time, so asking for the same row again shows it again. */
export interface Focus { id: number }

/** Returns a setter that scrolls the element with that DOM id to the top of its scroller as soon as it has rendered. */
export function useScrollIntoView() {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!target) return;
    const el = document.getElementById(target);
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    setTarget(null);
  });
  return setTarget;
}
