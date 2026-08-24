export function formatElapsedDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds) / 1000) || 0);
  return `耗时 ${Math.floor(totalSeconds / 60)}分${totalSeconds % 60}秒`;
}
