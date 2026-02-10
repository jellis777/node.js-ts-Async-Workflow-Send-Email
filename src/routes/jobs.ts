import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db';

// runtime validation for job payload
const sendEmailJobSchema = z.object({
  to: z.email(),
  subject: z.string().min(1),
  body: z.string().min(1),
});

// validation for UUID format
const uuidSchema = z.string().uuid();

export async function jobRoutes(app: FastifyInstance) {
  app.post('/jobs/email', async (request, reply) => {
    const idempotencyKey = request.headers['idempotency-key'] as
      | string
      | undefined;
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    const parsed = sendEmailJobSchema.safeParse(request.body);

    if (!tenantId) {
      return reply.status(400).send({
        error: 'Missing X-Tenant-Id header',
      });
    }

    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid job payload',
      });
    }

    const payload = parsed.data;

    if (idempotencyKey) {
      const existing = await pool.query(
        `SELECT id, status
             FROM jobs
             WHERE tenant_id = $1
               AND idempotency_key = $2`,
        [tenantId, idempotencyKey]
      );

      if (existing.rows.length > 0) {
        return reply.status(202).send({
          tenant_id: tenantId,
          job_id: existing.rows[0].id,
          status: existing.rows[0].status,
        });
      }
    }

    try {
      const result = await pool.query(
        `INSERT INTO jobs (type, payload, tenant_id, idempotency_key)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        ['send_email', payload, tenantId, idempotencyKey ?? null]
      );

      request.log.info(
        {
          tenant_id: tenantId,
          job_id: result.rows[0].id,
        },
        'job enqueued'
      );

      return reply.status(202).send({
        job_id: result.rows[0].id,
        status: 'queued',
      });
    } catch (err) {
      request.log.error({ err }, 'failed to enqueue job');

      return reply.status(500).send({
        error: 'Failed to enqueue job',
      });
    }
  });

  app.get('/jobs/:id', async (request, reply) => {
    const jobId = (request.params as any).id;
    const tenantId = request.headers['x-tenant-id'] as string | undefined;

    // Validate tenant ID
    if (!tenantId) {
      return reply.status(400).send({
        error: 'Missing X-Tenant-Id header',
      });
    }

    // Validate job ID format
    const jobIdValidation = uuidSchema.safeParse(jobId);
    if (!jobIdValidation.success) {
      return reply.status(400).send({
        error: 'Invalid job ID format',
      });
    }

    try {
      const result = await pool.query(
        `SELECT *
            FROM jobs
            WHERE id = $1
              AND tenant_id = $2`,
        [jobId, tenantId]
      );
      if (result.rows.length === 0) {
        return reply.status(404).send({
          error: 'Job not found',
        });
      }
      return reply.send(result.rows[0]);
    } catch (err) {
      request.log.error({ err, jobId }, 'failed to fetch job');

      return reply.status(500).send({
        error: 'Internal server error',
      });
    }
  });
}
