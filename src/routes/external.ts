import { FastifyInstance } from 'fastify';

export async function externalRoutes(app: FastifyInstance) {
  app.post('/external/send-email', async () => {
    // randomly fail
    if (Math.random() < 0.5) {
      throw new Error('external service failed');
    }

    return { status: 'email sent' };
  });
}
