/**
 * Type declarations for @parse/node-apn
 * Fixes CommonJS module compatibility and adds iOS 15+ features
 */

declare module '@parse/node-apn' {
  export class Provider {
    constructor(options: ProviderOptions);
    send(notification: Notification, recipients: string | string[]): Promise<ProviderResult>;
    shutdown(): Promise<void>;
  }

  export interface ProviderOptions {
    token?: {
      key: string | Buffer;
      keyId: string;
      teamId: string;
    };
    cert?: string | Buffer;
    key?: string | Buffer;
    ca?: (string | Buffer)[];
    pfx?: string | Buffer;
    passphrase?: string;
    production?: boolean;
    address?: string;
    port?: number;
    proxy?: { host: string; port: number | string };
    rejectUnauthorized?: boolean;
    connectionRetryLimit?: number;
    heartBeat?: number;
    requestTimeout?: number;
  }

  export interface ProviderResult {
    sent: Array<{ device: string }>;
    failed: Array<{
      device: string;
      error?: Error;
      status?: string;
      response?: { reason: string };
    }>;
  }

  export class Notification {
    constructor();

    // Basic properties
    alert?: string | {
      title?: string;
      subtitle?: string;
      body?: string;
      'title-loc-key'?: string;
      'title-loc-args'?: string[];
      'action-loc-key'?: string;
      'loc-key'?: string;
      'loc-args'?: string[];
      'launch-image'?: string;
    };
    badge?: number;
    sound?: string | {
      critical?: number;
      name?: string;
      volume?: number;
    };
    topic?: string;
    id?: string;
    expiry?: number;
    priority?: number;
    collapseId?: string;
    pushType?: 'alert' | 'background' | 'voip' | 'pushtotalk' | 'liveactivity' | 'location' | 'complication' | 'fileprovider' | 'mdm';

    // Payload
    payload?: any;
    rawPayload?: any;

    // Additional features
    contentAvailable?: boolean;
    mutableContent?: boolean;
    threadId?: string;
    category?: string;
    urlArgs?: string[];
    mdm?: string | object;

    // iOS 15+ features
    interruptionLevel?: 'passive' | 'active' | 'time-sensitive' | 'critical';
    relevanceScore?: number;
    filterCriteria?: string;

    // iOS 16.1+ features (Live Activities)
    targetContentId?: string;
    timestamp?: number;
    staleDate?: number;
    event?: 'update' | 'end';
    contentState?: object;
    dismissalDate?: number;
  }

  export class MultiProvider {
    constructor(options: MultiProviderOptions);
    send(notification: Notification, recipients: string | string[]): Promise<ProviderResult>;
    shutdown(): Promise<void>;
  }

  export interface MultiProviderOptions extends ProviderOptions {
    clientCount?: number;
  }

  export function token(tokenData: string | Buffer): string;
}
