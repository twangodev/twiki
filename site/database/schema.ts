import {
	customType,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

const isoDate = customType<{ data: Date; driverData: string }>({
	dataType: () => 'date',
	toDriver: (value) => value.toISOString(),
	fromDriver: (value) => new Date(value)
});
const bigint = customType<{ data: number; driverData: number }>({ dataType: () => 'bigint' });

export const user = sqliteTable('user', {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	email: text().notNull().unique(),
	emailVerified: integer({ mode: 'boolean' }).notNull(),
	image: text(),
	createdAt: isoDate().notNull(),
	updatedAt: isoDate().notNull()
});

export const session = sqliteTable(
	'session',
	{
		id: text().primaryKey().notNull(),
		expiresAt: isoDate().notNull(),
		token: text().notNull().unique(),
		createdAt: isoDate().notNull(),
		updatedAt: isoDate().notNull(),
		ipAddress: text(),
		userAgent: text(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(table) => [index('session_userId_idx').on(table.userId)]
);

export const account = sqliteTable(
	'account',
	{
		id: text().primaryKey().notNull(),
		issuer: text().notNull(),
		accountId: text().notNull(),
		providerId: text().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text(),
		refreshToken: text(),
		idToken: text(),
		accessTokenExpiresAt: isoDate(),
		refreshTokenExpiresAt: isoDate(),
		scope: text(),
		password: text(),
		createdAt: isoDate().notNull(),
		updatedAt: isoDate().notNull()
	},
	(table) => [
		index('account_userId_idx').on(table.userId),
		uniqueIndex('account_issuer_accountId_uidx').on(table.issuer, table.accountId)
	]
);

export const verification = sqliteTable(
	'verification',
	{
		id: text().primaryKey().notNull(),
		identifier: text().notNull(),
		value: text().notNull(),
		expiresAt: isoDate().notNull(),
		createdAt: isoDate().notNull(),
		updatedAt: isoDate().notNull()
	},
	(table) => [index('verification_identifier_idx').on(table.identifier)]
);

export const rateLimit = sqliteTable('rateLimit', {
	id: text().primaryKey().notNull(),
	key: text().notNull().unique(),
	count: integer().notNull(),
	lastRequest: bigint().notNull()
});

export const siteAccess = sqliteTable('siteAccess', {
	githubId: text().primaryKey().notNull(),
	githubLogin: text().notNull(),
	createdAt: integer().notNull()
});
