import { siGithub } from 'simple-icons';

export function returnPath(value: unknown): string {
	if (
		typeof value !== 'string' ||
		!value.startsWith('/') ||
		value.startsWith('//') ||
		/[\\\x00-\x20]/.test(value) ||
		/%2f|%5c|%0[ad]/i.test(value)
	)
		return '/';
	const path = new URL(value, 'https://local.invalid');
	if (
		path.pathname.startsWith('//') ||
		path.pathname === '/login' ||
		path.pathname.startsWith('/api/auth/') ||
		path.pathname === '/logout'
	)
		return '/';
	return path.pathname + path.search + path.hash;
}

function escape(value: string) {
	return value.replace(
		/[&<>"']/g,
		(character) =>
			({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
	);
}

export function loginPage(next: string, failed: boolean) {
	const nonce = crypto.randomUUID();
	return new Response(
		`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Wisconsin</title>
<script nonce="${nonce}">try{const mode=localStorage.getItem('mode-watcher-mode');if(mode==='light'||mode==='dark')document.documentElement.style.colorScheme=mode}catch{}</script>
<style>
@font-face{font-family:'Overused Grotesk';src:url('/fonts/OverusedGrotesk-VF.woff2') format('woff2');font-weight:300 900;font-style:normal;font-display:swap}
:root{color-scheme:light dark;--bg:light-dark(#f8f6f1,#1a1916);--text:light-dark(#1a1916,#e8e5df);--muted:light-dark(#8a8578,#7a7568);--accent:light-dark(#d35545,#e68578);font-family:'Overused Grotesk',system-ui,sans-serif;background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased}
body{margin:0;min-height:100svh;display:grid;place-items:center}main{width:min(21rem,calc(100% - 3rem))}
h1{font-size:2rem;font-weight:650;letter-spacing:-.04em;line-height:1.1;margin:0 0 .65rem}p{font-size:1rem;line-height:1.6;color:color-mix(in srgb,var(--muted),var(--text) 25%);margin:0}
button{display:flex;align-items:center;justify-content:center;gap:.65rem;width:100%;border:1px solid transparent;border-radius:.5rem;background:var(--text);color:var(--bg);padding:.8rem 1rem;font:inherit;font-weight:600;cursor:pointer;margin-top:1.5rem;transition:background-color 120ms}
button:hover{background:color-mix(in srgb,var(--text),var(--accent) 20%)}button:focus-visible{outline:2px solid var(--accent);outline-offset:4px}button svg{flex-shrink:0}.error{color:var(--accent);margin-top:1rem}
@media(prefers-reduced-motion:reduce){button{transition:none}}
</style></head><body><main><h1>Wisconsin</h1><p>A private space for course notes.</p>
${failed ? '<p class="error" role="alert">Sign-in was unsuccessful. Please use your authorized GitHub account and try again.</p>' : ''}
<form method="post" action="/login"><input type="hidden" name="next" value="${escape(returnPath(next))}"><button><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="${siGithub.path}"/></svg>Continue with GitHub</button></form>
</main></body></html>`,
		{
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self' https://github.com; frame-ancestors 'none'; base-uri 'none'`
			}
		}
	);
}
