import { PlatformBadge, type PlatformId } from './platform-icons';

const NODES: { id: PlatformId; top: string; left: string; delay: string; duration: string; rotate: string }[] = [
  { id: 'whatsapp', top: '8%', left: '5%', delay: '0s', duration: '7s', rotate: '-6deg' },
  { id: 'instagram', top: '66%', left: '10%', delay: '-2.4s', duration: '8.5s', rotate: '5deg' },
  { id: 'messenger', top: '14%', left: '93%', delay: '-4.1s', duration: '6.5s', rotate: '-4deg' },
  { id: 'web', top: '74%', left: '88%', delay: '-1.2s', duration: '9s', rotate: '6deg' },
];

// Index pairs into NODES — a loose loop plus one crossing edge so it reads
// as a network, not just a rectangle.
const EDGES: [number, number][] = [
  [0, 1],
  [1, 3],
  [3, 2],
  [2, 0],
  [0, 3],
];

/**
 * Hero background — the four channel badges drifting behind the headline,
 * joined by faint dashed lines whose dashes slowly flow along the path. Says
 * "every channel, connected" spatially instead of adding a fifth line of
 * copy. Pure CSS (icon drift reuses .animate-float, lines use .animate-dash
 * — both defined in globals.css and already collapse to a single still
 * frame under prefers-reduced-motion), so this stays a server component:
 * no timers, no client state, nothing for hydration to mismatch.
 */
export function HeroNetworkBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10"
      style={{
        maskImage: 'radial-gradient(ellipse 60% 50% at 50% 0%, black 40%, transparent 80%)',
        WebkitMaskImage: 'radial-gradient(ellipse 60% 50% at 50% 0%, black 40%, transparent 80%)',
      }}
    >
      <svg
        className="absolute inset-0 size-full text-foreground/[0.16]"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {EDGES.map(([a, b], i) => {
          const pa = NODES[a];
          const pb = NODES[b];
          return (
            <line
              key={i}
              x1={parseFloat(pa.left)}
              y1={parseFloat(pa.top)}
              x2={parseFloat(pb.left)}
              y2={parseFloat(pb.top)}
              stroke="currentColor"
              strokeWidth="0.15"
              strokeDasharray="1.6 1.6"
              className="animate-dash"
            />
          );
        })}
      </svg>

      {NODES.map((node) => (
        <div
          key={node.id}
          className="animate-float absolute"
          style={
            {
              top: node.top,
              left: node.left,
              animationDelay: node.delay,
              animationDuration: node.duration,
              '--float-rotate': node.rotate,
            } as React.CSSProperties
          }
        >
          <PlatformBadge platform={node.id} className="size-8 opacity-60 shadow-none sm:size-9" iconClassName="size-3.5" />
        </div>
      ))}
    </div>
  );
}
