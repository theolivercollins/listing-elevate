/**
 * Minimal ambient declarations for the Google Identity Services (GIS) OAuth
 * client, the GIS Sign-In (ID-token) client, and the Google Picker API — all
 * loaded lazily via the same `https://accounts.google.com/gsi/client`
 * <script> tag (see `@/lib/google-picker`'s `loadScript`/`GIS_URL`).
 *
 * Only the surface we actually use is typed — extend as needed.
 */

declare namespace google {
  namespace accounts {
    namespace oauth2 {
      interface TokenResponse {
        access_token?: string;
        /** Lifetime of the access token, in seconds. GIS returns this as a
         *  numeric string at runtime; declared loosely so callers normalize
         *  via `Number(...)`. */
        expires_in?: string | number;
        error?: string;
      }
      interface TokenClientConfig {
        client_id: string;
        scope: string;
        /** '' (empty string) lets GIS reuse an existing grant silently;
         *  'consent' forces the consent screen every time. */
        prompt?: '' | 'none' | 'consent' | 'select_account';
        callback: (response: TokenResponse) => void;
        error_callback?: (err: { message: string }) => void;
      }
      interface TokenClient {
        requestAccessToken(): void;
      }
      function initTokenClient(config: TokenClientConfig): TokenClient;
    }

    // "Sign in with Google" ID-token flow (One Tap / GSI button) — used by
    // `@/lib/googleIdentity` because the Supabase Google provider is
    // configured with a Client ID only (no client secret rules out the
    // OAuth-redirect flow, which needs one to exchange the auth code).
    namespace id {
      interface CredentialResponse {
        /** The signed Google ID token (JWT) — handed to Supabase's
         *  `signInWithIdToken`, never decoded/trusted client-side. */
        credential: string;
      }
      interface IdConfiguration {
        client_id: string;
        /** SHA-256 hex digest of a client-generated random value. Supabase's
         *  `signInWithIdToken` is given the RAW value separately and hashes
         *  it itself to compare against the token's `nonce` claim — binding
         *  the ID token to this exact sign-in attempt. */
        nonce: string;
        callback: (response: CredentialResponse) => void;
        auto_select?: boolean;
        use_fedcm_for_prompt?: boolean;
      }
      interface GsiButtonConfiguration {
        type?: 'standard' | 'icon';
        theme?: 'outline' | 'filled_blue' | 'filled_black';
        size?: 'large' | 'medium' | 'small';
        text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
        shape?: 'rectangular' | 'pill' | 'circle' | 'square';
        logo_alignment?: 'left' | 'center';
        width?: number;
      }
      function initialize(config: IdConfiguration): void;
      function renderButton(parent: HTMLElement, options: GsiButtonConfiguration): void;
      function prompt(): void;
      function cancel(): void;
    }
  }

  namespace picker {
    namespace Action {
      const PICKED: string;
      const CANCEL: string;
      const LOADED: string;
    }
    namespace Feature {
      const MULTISELECT_ENABLED: string;
    }
    namespace ViewId {
      const DOCS: string;
    }
    interface PickerDocument {
      id: string;
      name: string;
      mimeType: string;
    }
    interface PickerCallback {
      action: string;
      docs?: PickerDocument[];
    }
    interface PickerInstance {
      setVisible(visible: boolean): void;
    }
    class DocsView {
      constructor(viewId?: string);
      setIncludeFolders(val: boolean): this;
      setSelectFolderEnabled(val: boolean): this;
    }
    class PickerBuilder {
      addView(view: DocsView): this;
      enableFeature(feature: string): this;
      setOAuthToken(token: string): this;
      setDeveloperKey(key: string): this;
      setAppId(appId: string): this;
      setCallback(callback: (data: PickerCallback) => void): this;
      build(): PickerInstance;
    }
  }
}

declare namespace gapi {
  function load(libraries: string, callback: () => void): void;
}
