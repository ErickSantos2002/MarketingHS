import { useEffect, useRef } from "react";

/**
 * Adds .is-visible to any element with .ha-reveal when it enters the viewport.
 * Scoped: runs once on mount, watches the whole document for .ha-reveal nodes
 * created later (e.g. lazy sections) via re-observation on demand.
 */
export function useReveal() {
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -50px 0px" }
    );
    observerRef.current = observer;

    const observeAll = () => {
      document.querySelectorAll(".ha-reveal:not(.is-visible)").forEach((el) => {
        observer.observe(el);
      });
    };
    observeAll();

    // Re-scan after a tick to catch lazy-rendered children
    const t1 = setTimeout(observeAll, 300);
    const t2 = setTimeout(observeAll, 1500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      observer.disconnect();
    };
  }, []);
}
