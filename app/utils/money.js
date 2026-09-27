/**
 * Money utilities for integer paise calculations.
 * 1 Rupee = 100 Paise.
 * ALL internal marketplace calculations MUST use integer paise to eliminate floating-point drift.
 */

/**
 * Converts any monetary value (rupees as number, string, or null) to integer paise.
 * @param {number|string|null|undefined} rupees
 * @returns {number} Integer paise
 */
export function toPaise(rupees) {
  if (rupees === null || rupees === undefined || isNaN(Number(rupees))) return 0;
  return Math.round(Number(rupees) * 100);
}

/**
 * Converts integer paise to a float representation in Rupees with 2 decimal places.
 * @param {number|null|undefined} paise
 * @returns {number}
 */
export function toRupees(paise) {
  if (!paise || isNaN(Number(paise))) return 0;
  return Math.round(Number(paise)) / 100;
}

/**
 * Calculates a percentage of an amount in paise, rounded to the nearest integer paise.
 * @param {number} amountPaise
 * @param {number} ratePercent (0 - 100)
 * @returns {number} Integer paise
 */
export function calcPercentagePaise(amountPaise, ratePercent) {
  if (!amountPaise || !ratePercent) return 0;
  return Math.round((Number(amountPaise) * Number(ratePercent)) / 100);
}

/**
 * Allocates a total amount (in paise) proportionally across items based on their individual weights
 * using the Largest Remainder Method (Hare-Niemeyer method).
 *
 * This ensures:
 * 1. Every allocation is an integer number of paise.
 * 2. sum(allocated) === totalPaise ALWAYS, with zero rounding error.
 *
 * @param {number} totalPaise The exact total amount to distribute
 * @param {Array<{ key: string, weight: number }>} items List of items with weights (e.g. line subtotal)
 * @returns {Map<string, number>} Map of item key -> allocated paise
 */
export function allocateProportionallyPaise(totalPaise, items) {
  const allocation = new Map();
  if (!items || items.length === 0) return allocation;

  const totalPaiseInt = Math.round(Number(totalPaise) || 0);
  if (totalPaiseInt === 0) {
    for (const item of items) {
      allocation.set(item.key, 0);
    }
    return allocation;
  }

  const totalWeight = items.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0);
  if (totalWeight <= 0) {
    // Distribute equally if no weights
    const baseShare = Math.floor(totalPaiseInt / items.length);
    let remainder = totalPaiseInt - (baseShare * items.length);
    for (let i = 0; i < items.length; i++) {
      const extra = remainder > 0 ? 1 : (remainder < 0 ? -1 : 0);
      remainder -= extra;
      allocation.set(items[i].key, baseShare + extra);
    }
    return allocation;
  }

  // Calculate exact shares, floor them to integer paise, and record remainders
  let allocatedSum = 0;
  const fractions = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const weight = Math.max(0, Number(item.weight) || 0);
    const exactShare = (totalPaiseInt * weight) / totalWeight;
    const floorShare = Math.floor(exactShare);
    const remainder = exactShare - floorShare;

    allocation.set(item.key, floorShare);
    allocatedSum += floorShare;
    fractions.push({ key: item.key, remainder, index: i });
  }

  // Distribute unallocated remainder paise to items with the largest fractional remainders
  let remainderPaise = totalPaiseInt - allocatedSum;
  fractions.sort((a, b) => b.remainder - a.remainder);

  for (let i = 0; i < remainderPaise; i++) {
    const target = fractions[i % fractions.length];
    const current = allocation.get(target.key) || 0;
    allocation.set(target.key, current + 1);
  }

  return allocation;
}
