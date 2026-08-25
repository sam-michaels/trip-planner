/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** MapTiler free-tier API key. Get one at https://cloud.maptiler.com/account/keys/ */
  readonly VITE_MAPTILER_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
