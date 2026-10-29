/**
 * The selling price a gold rate gives: net weight × rate per gram, plus making
 * charge, rounded to the nearest 100 LKR.
 */
export function ratePriceLkr(netG: number, ratePerG: number, makingLkr = 0): number {
  return Math.round((netG * ratePerG + makingLkr) / 100) * 100;
}
