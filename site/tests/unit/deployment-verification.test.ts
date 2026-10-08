import { expect, test } from 'bun:test';
import { matchesDeployment } from '../../tooling/verify-deployment';

const descriptor = {
	schemaVersion: 1,
	applicationVersion: 'a'.repeat(64),
	snapshots: { public: 'b'.repeat(64), full: 'c'.repeat(64) }
};
function response(snapshot: string, application = descriptor.applicationVersion, status = 200) {
	return new Response('', {
		status,
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'x-wisconsin-content-version': snapshot,
			'x-wisconsin-application-version': application
		}
	});
}
test('live verification rejects old content even when the application was reused', () => {
	expect(matchesDeployment(response('d'.repeat(64)), descriptor)).toBe(false);
	expect(matchesDeployment(response(descriptor.snapshots.public), descriptor)).toBe(true);
});
test('live verification rejects full edition, wrong app, and login/error responses', () => {
	expect(matchesDeployment(response(descriptor.snapshots.full), descriptor)).toBe(false);
	expect(matchesDeployment(response(descriptor.snapshots.public, 'd'.repeat(64)), descriptor)).toBe(
		false
	);
	expect(
		matchesDeployment(
			response(descriptor.snapshots.public, descriptor.applicationVersion, 503),
			descriptor
		)
	).toBe(false);
	expect(matchesDeployment(new Response('login', { status: 200 }), descriptor)).toBe(false);
});
