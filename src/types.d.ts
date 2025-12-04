declare module '*.html' {
  const html: string;
  export default html;
}

declare module 'gradient-parser' {
  export interface GradientLength {
    type?: string;
    value?: string | number;
  }

  export interface GradientOrientationValue {
    value?: string;
  }

  export interface GradientOrientation {
    type?: string;
    value?: GradientOrientationValue | string;
  }

  export interface GradientColorStop {
    type?: string;
    value?: string | string[];
    length?: GradientLength;
  }

  export interface GradientNode {
    type?: string;
    orientation?: GradientOrientation | GradientOrientation[];
    colorStops?: GradientColorStop[];
  }

  const gradientParser: { parse: (input: string) => GradientNode[] };
  export default gradientParser;
}
