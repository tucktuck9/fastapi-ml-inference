/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Backend API URL used during local dev (`npm run dev`).
   * Set in `.env` or `.env.local`. See `.env.example`.
   * In production, the app reads window.__ENV__.BACKEND_URL instead.
   */
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Runtime env vars written by entrypoint.sh at container startup.
 * Declared here so TypeScript knows about window.__ENV__ without casts.
 * Mirrored in entrypoint.sh — keep both in sync when adding new vars.
 */
interface Window {
  __ENV__?: {
    BACKEND_URL?: string;
  };
}
