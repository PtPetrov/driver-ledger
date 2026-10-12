/** Split this service only. Existing no-helper records keep their exact calculation. */
export function splitServiceEarnings(amount: number, driverIds: string[], helperCount = 0) {
  if (!Number.isSafeInteger(helperCount) || helperCount < 0 || helperCount > 1000) {
    throw new RangeError("Invalid helper count");
  }
  if (helperCount === 0) {
    return { drivers: Object.fromEntries(driverIds.map(id => [id, amount / Math.max(driverIds.length, 1)])), helpersTotal: 0 };
  }
  // Allocate whole cents deterministically: drivers in saved order, then helpers.
  // Shares differ by at most one cent and add up to the service total exactly.
  const cents = Math.round((amount + Number.EPSILON) * 100);
  const people = driverIds.length + helperCount;
  const base = Math.floor(cents / people);
  const remainder = cents % people;
  const driverCents = driverIds.map((_, index) => base + (index < remainder ? 1 : 0));
  return {
    drivers: Object.fromEntries(driverIds.map((id, index) => [id, driverCents[index] / 100])),
    helpersTotal: (cents - driverCents.reduce((sum, value) => sum + value, 0)) / 100,
  };
}
