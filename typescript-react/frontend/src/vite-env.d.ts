/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Backend API URL. Replaced at build time by Vite.
   * Set in `.env.local` for local dev or via Render env vars in production.
   * See `.env.example`.
   */
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
