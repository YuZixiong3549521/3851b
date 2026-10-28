export const MAX_AC_UNITS = 20;
export function recommendedTeamSize(units) {
  return Math.max(1, Math.ceil(Number(units || 1) / 4));
}
export function teamDuration(
  units,
  members,
  cleaningMinutes,
  diagnosticMinutes = 0,
) {
  return (
    Math.ceil(Number(units) / Math.max(1, Number(members))) *
      Number(cleaningMinutes || 0) +
    Number(diagnosticMinutes || 0)
  );
}
