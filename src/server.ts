import { buildApp } from './app';
import { env } from './config/env';
import { externalRoutes } from './routes/external';
import { healthRoutes } from './routes/health';
import { jobRoutes } from './routes/jobs';
import { notesRoutes } from './routes/notes';

async function main() {
  const app = buildApp();

  app.register(healthRoutes);
  app.register(notesRoutes);
  app.register(jobRoutes);
  app.register(externalRoutes);

  await app.listen({
    port: Number(env.PORT),
    host: '0.0.0.0',
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
