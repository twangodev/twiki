export function frameOptions(response: Response) {
	const contentType = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
	return response.ok && contentType === 'application/pdf' ? 'SAMEORIGIN' : 'DENY';
}
