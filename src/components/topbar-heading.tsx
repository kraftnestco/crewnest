'use client';

/**
 * Lets each page's `PageHeader` (deep inside `{children}`) publish its title
 * into the topbar (in the layout, a sibling of `{children}`) without prop
 * drilling. Works because the layout's Server Component `{children}` subtree
 * still participates in Context lookups from Client Component descendants —
 * `PageHeader` just needs to be a client component that writes into context.
 */
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';

interface TopbarHeading {
  title: string;
  description?: string;
  actions?: ReactNode;
}

const TopbarHeadingContext = createContext<{
  heading: TopbarHeading | null;
  setHeading: (heading: TopbarHeading | null) => void;
} | null>(null);

export function TopbarHeadingProvider({ children }: { children: ReactNode }) {
  const [heading, setHeading] = useState<TopbarHeading | null>(null);
  return (
    <TopbarHeadingContext.Provider value={{ heading, setHeading }}>{children}</TopbarHeadingContext.Provider>
  );
}

/** Called by `PageHeader` to publish (and clear on unmount) the active page's heading. */
export function usePublishTopbarHeading(heading: TopbarHeading) {
  const ctx = useContext(TopbarHeadingContext);
  useLayoutEffect(() => {
    ctx?.setHeading(heading);
    return () => ctx?.setHeading(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heading.title, heading.description, heading.actions]);
}

/**
 * Rendered in the topbar (desktop only) to show whichever page is currently
 * mounted. Title only — no description/subtext here, the topbar row is too
 * slim for two lines; the full title+description pairing still shows inline
 * on mobile via `PageHeader`'s `lg:hidden` block.
 */
export function TopbarHeadingSlot() {
  const ctx = useContext(TopbarHeadingContext);
  const heading = ctx?.heading;
  if (!heading) return null;
  return (
    <p className="hidden min-w-0 truncate py-0.5 font-hero-display text-2xl leading-tight lg:block">{heading.title}</p>
  );
}

/** Rendered in the topbar (desktop only) alongside the heading — the current page's `actions`. */
export function TopbarActionsSlot() {
  const ctx = useContext(TopbarHeadingContext);
  const actions = ctx?.heading?.actions;
  if (!actions) return null;
  return <div className="hidden shrink-0 items-center gap-2 lg:flex">{actions}</div>;
}
