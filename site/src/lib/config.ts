import metadata from './site-config.json';
import authentication from './auth-config.json';

/** Consumer branding is copied into the staged engine before any build or dev process. */
export const site = metadata;

/** Only configured server authentication exposes account controls. Static exports have no session API. */
export const authEnabled =
	authentication.enabled === true && import.meta.env?.VITE_STATIC_EXPORT !== 'true';
