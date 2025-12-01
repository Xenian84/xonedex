/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROTOCOL_TREASURY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

