/**
 * @file HubLinksToggle.tsx
 * @description Accessible control for showing hub relationships in large diagrams.
 */
export function HubLinksToggle({
  hubs,
  count,
  shown,
  onToggle,
}: {
  hubs: Map<string, number>;
  count: number;
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="Hub links"
      aria-pressed={shown}
      title={`Hub tables: ${[...hubs.keys()].join(", ")}`}
      onClick={onToggle}
      className="pointer-events-auto bg-background border border-border rounded px-2 py-1.5 text-[10px] text-muted-foreground hover:bg-muted"
    >
      Hub links: {count} {shown ? "shown" : "hidden"}
    </button>
  );
}
