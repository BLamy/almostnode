declare module 'sha.js' {
  interface ShaInstance {
    update(data: string | ArrayBuffer | ArrayBufferView): this;
    digest(): Uint8Array;
    digest(encoding: 'hex' | 'base64'): string;
  }

  interface ShaFactory {
    (algorithm: string): ShaInstance;
  }

  const shajs: ShaFactory;
  export default shajs;
}
