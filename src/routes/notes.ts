import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db';

const createNoteSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
});

export async function notesRoutes(app: FastifyInstance) {
  app.post('/notes', async (request, reply) => {
    const parsed = createNoteSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid request body',
        details: parsed.error.flatten(),
      });
    }

    const { title, content } = parsed.data;

    // Insert into Postgres
    try {
      const result = await pool.query(
        `INSERT INTO notes (title, content)
         VALUES ($1, $2)
         RETURNING id, title, content, created_at`,
        [title, content]
      );

      return reply.status(201).send(result.rows[0]);
    } catch (err) {
      request.log.error({ err }, 'failed to insert note');

      return reply.status(500).send({
        error: 'Internal server error',
      });
    }
  });
}
