declare module "qrcode" {
  interface QRCodeColorOptions {
    dark?: string;
    light?: string;
  }

  interface QRCodeToStringOptions {
    type?: "svg" | "terminal" | "utf8";
    width?: number;
    margin?: number;
    color?: QRCodeColorOptions;
  }

  interface QRCodeStatic {
    toString(text: string, options?: QRCodeToStringOptions): Promise<string>;
  }

  const qrcode: QRCodeStatic;
  export default qrcode;
}
