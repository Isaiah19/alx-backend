import express from 'express';
import { promisify } from 'util';
import { createQueue } from 'kue';
import { createClient } from 'redis';

const app = express();
const client = createClient();
const queue = createQueue();
const INITIAL_SEATS_COUNT = 50;
let reservationEnabled = false;
const PORT = 1245;

client.on('error', (err) => {
  console.error('Redis client not connected to the server:', err);
});

client.on('connect', () => {
  console.log('Redis client connected to the server');
});

/**
 * Modifies the number of available seats.
 * @param {number} number - The new number of seats.
 */
const reserveSeat = async (number) => {
  const setAsync = promisify(client.SET).bind(client);
  await setAsync('available_seats', number);
};

/**
 * Retrieves the number of available seats.
 * @returns {Promise<number>}
 */
const getCurrentAvailableSeats = async () => {
  const getAsync = promisify(client.GET).bind(client);
  const result = await getAsync('available_seats');
  return Number.parseInt(result || 0);
};

app.get('/available_seats', async (_, res) => {
  try {
    const numberOfAvailableSeats = await getCurrentAvailableSeats();
    res.json({ numberOfAvailableSeats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/reserve_seat', (_req, res) => {
  if (!reservationEnabled) {
    res.json({ status: 'Reservation are blocked' });
    return;
  }
  try {
    const job = queue.create('reserve_seat').save();

    job.on('failed', (err) => {
      console.log('Seat reservation job', job.id, 'failed:', err.message || err.toString());
    });
    job.on('complete', () => {
      console.log('Seat reservation job', job.id, 'completed');
    });

    res.json({ status: 'Reservation in process' });
  } catch {
    res.json({ status: 'Reservation failed' });
  }
});

app.get('/process', (_req, res) => {
  res.json({ status: 'Queue processing' });
  queue.process('reserve_seat', async (_job, done) => {
    try {
      const availableSeats = await getCurrentAvailableSeats();
      reservationEnabled = availableSeats <= 1 ? false : reservationEnabled;
      if (availableSeats >= 1) {
        await reserveSeat(availableSeats - 1);
        done();
      } else {
        done(new Error('Not enough seats available'));
      }
    } catch (error) {
      done(error);
    }
  });
});

const resetAvailableSeats = async (initialSeatsCount) => {
  const setAsync = promisify(client.SET).bind(client);
  await setAsync('available_seats', Number.parseInt(initialSeatsCount));
};

app.listen(PORT, async () => {
  try {
    await resetAvailableSeats(process.env.INITIAL_SEATS_COUNT || INITIAL_SEATS_COUNT);
    reservationEnabled = true;
    console.log(`API available on localhost port ${PORT}`);
  } catch (error) {
    console.error('Error setting initial seats:', error);
  }
});

export default app;

