// Normal deployments render notes on the server; static export remains optional.
export const prerender = import.meta.env.VITE_STATIC_EXPORT === 'true';
export const trailingSlash = 'never';
