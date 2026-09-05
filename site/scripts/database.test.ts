import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import * as schema from '../database/schema';
import snapshot from '../migrations/meta/0002_snapshot.json';

test('Drizzle schema is baselined without a new migration', async () => {
	const current = await generateSQLiteDrizzleJson(schema);
	expect(await generateSQLiteMigration(snapshot, current)).toEqual([]);
});

test('Drizzle preserves existing columns, constraints and indexes', async () => {
	const existing = new Database(':memory:');
	const generated = new Database(':memory:');
	try {
		for (const file of readdirSync('migrations')
			.filter((file) => file.endsWith('.sql'))
			.sort()) {
			existing.exec(readFileSync(`migrations/${file}`, 'utf8'));
		}
		const statements = await generateSQLiteMigration(
			await generateSQLiteDrizzleJson({}),
			await generateSQLiteDrizzleJson(schema)
		);
		for (const statement of statements) generated.exec(statement);
		const tables = existing
			.query<
				{ name: string },
				[]
			>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
			.all();
		for (const { name } of tables) {
			const columns = (db: Database) =>
				db
					.query<
						{ name: string; type: string; notnull: number; pk: number; dflt_value: unknown },
						[]
					>(`PRAGMA table_info('${name}')`)
					.all()
					.map(({ name, type, notnull, pk, dflt_value }) => ({
						name,
						type: type.toLowerCase(),
						notnull,
						pk,
						dflt_value
					}));
			const indexes = (db: Database) =>
				db
					.query<{ name: string; unique: number }, []>(`PRAGMA index_list('${name}')`)
					.all()
					.map((index) => ({
						unique: index.unique,
						columns: db
							.query<{ name: string }, []>(`PRAGMA index_info('${index.name}')`)
							.all()
							.map((column) => column.name)
					}))
					.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
			expect(columns(generated)).toEqual(columns(existing));
			expect(indexes(generated)).toEqual(indexes(existing));
			expect(generated.query(`PRAGMA foreign_key_list('${name}')`).all()).toEqual(
				existing.query(`PRAGMA foreign_key_list('${name}')`).all()
			);
		}
	} finally {
		existing.close();
		generated.close();
	}
});
