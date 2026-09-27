export function gToMg(g: number): number {
  return Math.round(g * 1000);
}
export function mgToG(mg: number): number {
  return mg / 1000;
}
export function lkrToCents(lkr: number): number {
  return Math.round(lkr * 100);
}
export function centsToLkr(cents: number): number {
  return cents / 100;
}
export function fineGoldMg(netMg: number, permille: number): number {
  return Math.round((netMg * permille) / 1000);
}
export function priceCents(netMg: number, rateCentsPerG: number, makingCents: number): number {
  return Math.round((netMg * rateCentsPerG) / 1000) + makingCents;
}
