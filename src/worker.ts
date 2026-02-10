import axios from 'axios';
import { pool } from './db';

async function processJobs() {
  while (true) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query(
        `
            SELECT *
            FROM jobs
            WHERE status = 'pending'
                AND run_at <= NOW()
            ORDER BY created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            `
      );

      if (result.rows.length === 0) {
        await client.query('COMMIT');
        client.release();

        // no jobs -- wait a bit
        await sleep(1000);
        continue;
      }

      const job = result.rows[0];

      await client.query(
        `UPDATE jobs
             SET status = 'processing'
             WHERE id = $1
                AND tenant_id = $2`,
        [job.id, job.tenant_id]
      );

      await client.query('COMMIT');
      client.release();

      // do the actual work
      await handleJob(job);
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      console.error('worker error', err);
    }
  }
}

async function handleJob(job: any) {
  if (job.status === 'completed') {
    return; // prevents double processing
  }
  try {
    console.log({ job_id: job.id, job_type: job.type }, 'starting job');

    switch (job.type) {
      case 'send_email':
        await handleSendEmail(job.payload);
        break;

      default:
        throw new Error(`unknown job type: ${job.type}`);
    }

    await pool.query(
      `UPDATE jobs
         SET status = 'completed'
         WHERE id = $1
          AND tenant_id = $2`,
      [job.id, job.tenant_id]
    );
  } catch (err: any) {
    await handleJobFailure(job, err);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleSendEmail(payload: any) {
  // pretend email sending
  try {
    const response = await axios.post(
      'http://localhost:3000/external/send-email',
      payload,
      {
        timeout: 3000, // 3 seconds max
      }
    );
    return response.data;
  } catch (err: any) {
    console.error(
      {
        error: err.message,
        payload,
      },
      'external email API failed'
    );

    throw err;
  }
}

async function handleJobFailure(job: any, err: Error) {
  const attempts = job.attempts + 1;

  console.error(
    { job_id: job.id, attempts: attempts, error: err.message },
    'job failed'
  );

  if (attempts >= job.max_attempts) {
    await pool.query(
      `UPDATE jobs
             SET status = 'failed',
                 attempts = $3,
                 last_error = $4
             WHERE id = $1 
             AND tenant_id = $2`,
      [job.id, job.tenant_id, attempts, err.message]
    );
  } else {
    await pool.query(
      `UPDATE jobs
             SET status = 'pending',
                 attempts = $3,
                 run_at = NOW() + INTERVAL '5 seconds',
                 last_error = $4
             WHERE id = $1
             AND tenant_id = $2`,
      [job.id, job.tenant_id, attempts, err.message]
    );
  }
}

processJobs();
