declare module "bwip-js" {
  export type ToSvgOptions = {
    bcid: string;
    text: string;
    scale?: number;
    height?: number;
    paddingwidth?: number;
    paddingheight?: number;
    eclevel?: "L" | "M" | "Q" | "H";
    includetext?: boolean;
    textxalign?: string;
  };
  const bwipjs: {
    toSVG(options: ToSvgOptions): string;
  };
  export default bwipjs;
}
