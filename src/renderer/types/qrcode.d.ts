declare module 'qrcode' {
  export interface QRCodeToStringOptions {
    type?: 'svg' | 'utf8';
    errorCorrectionLevel?: 'low' | 'medium' | 'quartile' | 'high' | 'L' | 'M' | 'Q' | 'H';
    margin?: number;
    width?: number;
    color?: {
      dark?: string;
      light?: string;
    };
  }

  export function toString(
    text: string,
    options?: QRCodeToStringOptions,
  ): Promise<string>;

  export function toString(
    text: string,
    options: QRCodeToStringOptions,
    callback: (err: Error | null, str: string) => void,
  ): void;
}

