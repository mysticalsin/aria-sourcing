export type IconName = "up" | "down" | "flat" | "check" | "clock" | "alert" | "cloud";

const PATHS: Record<IconName, string> = {
  up: "M4 14l8-8 8 8",
  down: "M4 10l8 8 8-8",
  flat: "M4 12h16",
  check: "M5 12l5 5L20 7",
  clock: "M12 7v6l4 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  alert: "M12 8v5M12 16h.01M12 3l9 16H3z",
  cloud: "M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 2A3.5 3.5 0 0 0 7 18z",
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}
