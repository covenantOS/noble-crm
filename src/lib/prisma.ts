import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL is not set');
    }
    const isSupabaseConnection = /supabase\.co|pooler\.supabase\.com/i.test(connectionString);
    // Supabase poolers/direct hosts can present cert chains that fail strict verification
    // in some serverless environments. Allowing this only for Supabase endpoints avoids
    // breaking connectivity while keeping defaults for other providers.
    const pool = new Pool({
        connectionString,
        ...(isSupabaseConnection ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    const adapter = new PrismaPg(pool);
    return new PrismaClient({
        adapter,
        log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
}

function getPrisma(): PrismaClient {
    if (globalForPrisma.prisma) return globalForPrisma.prisma;
    const client = createPrismaClient();
    if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client;
    return client;
}

export const prisma = new Proxy({} as PrismaClient, {
    get(_, prop) {
        return (getPrisma() as unknown as Record<string, unknown>)[prop as string];
    },
});

export default prisma;
