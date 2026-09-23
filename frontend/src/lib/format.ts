/** Duración legible: 45 s · 12 min · 3 h 12 min · 2 d 5 h */
export function formatUptime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  if (days > 0) return `${String(days)} d ${String(hours)} h`;
  if (hours > 0) return `${String(hours)} h ${String(minutes)} min`;
  if (minutes > 0) return `${String(minutes)} min`;
  return `${String(seconds)} s`;
}
