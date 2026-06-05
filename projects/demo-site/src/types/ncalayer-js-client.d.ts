// Minimal declarations for ncalayer-js-client (ships no types)
declare module "ncalayer-js-client" {
  export class NCALayerClient {
    static basicsStorageAll: unknown;
    static basicsCMSParamsDetached: unknown;
    static basicsCMSParamsAttached: unknown;
    static basicsSignerSignAny: unknown;
    static basicsSignerAuthAny: unknown;
    connect(): Promise<void>;
    basicsSignCMS(storage: unknown, data: string, params: unknown, signer: unknown): Promise<string>;
    basicsSign(...args: unknown[]): Promise<unknown>;
  }
}
