interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string
  readonly VITE_ALLOWED_EMAIL_DOMAINS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
