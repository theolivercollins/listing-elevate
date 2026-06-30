/**
 * Minimal ambient declarations for the Google Identity Services (GIS) OAuth
 * client and the Google Picker API, loaded lazily via <script> tags.
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
