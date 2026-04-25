import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/infrastructure/database/DrizzleSchema.ts',
  out: './drizzle', // The folder where migrations will be saved
  dialect: 'sqlite',
});