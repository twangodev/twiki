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
	return new Response(
		`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Wisconsin</title><style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif;background:light-dark(#faf9f6,#171717);color:light-dark(#262626,#eee)}
body{margin:0;min-height:100svh;display:grid;place-items:center}main{width:min(22rem,calc(100% - 3rem))}
h1{font-size:1.75rem;letter-spacing:-.04em;margin:0 0 .5rem}p{line-height:1.6;color:light-dark(#666,#aaa)}
button{width:100%;border:0;border-radius:.5rem;background:light-dark(#262626,#eee);color:light-dark(#fff,#171717);padding:.85rem 1rem;font:inherit;font-weight:600;cursor:pointer;margin-top:1rem}
button:focus-visible{outline:3px solid #b65b36;outline-offset:4px}.error{color:light-dark(#a13224,#ffada3)}
</style></head><body><main><h1>Wisconsin</h1><p>A private space for course notes.</p>
${failed ? '<p class="error" role="alert">Sign-in was unsuccessful. Please use your authorized GitHub account and try again.</p>' : ''}
<form method="post" action="/login"><input type="hidden" name="next" value="${escape(returnPath(next))}"><button>Continue with GitHub</button></form>
</main></body></html>`,
		{
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				'Content-Security-Policy':
					"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com; frame-ancestors 'none'; base-uri 'none'"
			}
		}
	);
}
