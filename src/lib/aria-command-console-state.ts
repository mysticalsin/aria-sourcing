export function shouldResetAriaChecklist({
  previousText,
  text,
  running,
}: {
  previousText: string | null;
  text: string;
  running: boolean;
}): boolean {
  return !running && previousText !== text;
}
