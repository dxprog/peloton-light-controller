import fs from 'fs/promises';
import fetch from 'node-fetch';
import { Peloton } from 'node-peloton';
import { Bonjour } from 'bonjour-service';

import config from '../config.json';

const TIME_TO_WAIT_FOR_WORKOUT = 60000;
const TIME_TO_WAIT_FOR_METRICS = 10000;
const TIME_TO_WAIT_FOR_MDNS = 60000;

// used to remap tread values to bike values that exercise lights understand
const RESISTANCE_MAX = 70;
const CADENCE_MAX = 120;
const SPEED_MAX = 12;
const INCLINE_MAX = 15;

let peloton;
let exerciseLightsIp;

async function discoverExerciseLights() {
  console.info('Looking for exercise-lights device...');
  return new Promise((resolve, reject) => {
    const bonjour = new Bonjour();
    const timeoutTime = Date.now() + TIME_TO_WAIT_FOR_MDNS;
    bonjour.find({ type: 'http' }, service => {
      if (service.name !== 'exercise-lights') {
        console.log(service.name);
        // check for a timeout
        if (Date.now() > timeoutTime) {
          reject();
        }
        return;
      }

      const lightsIp = service.referer.address;
      console.info(`exercise-lights device found at ${lightsIp}`);
      resolve(lightsIp);
    });
  });
}

async function start() {
  try {
    exerciseLightsIp = await discoverExerciseLights();
  } catch (err) {
    console.error('Unable to find exercise lights device');
    process.exit(1);
  }

  peloton = new Peloton(config.sessionId);
  if (!peloton.getSessionId()) {
    await peloton.login(config.username, config.password);
    await fs.writeFile('../config.json', JSON.stringify({
      ...config,
      sessionId: peloton.getSessionId(),
    }));
  }

  waitForWorkout();
}

async function checkInProgressWorkout(workoutId) {
  const workout = await peloton.getWorkoutById(workoutId);

  if (workout.status === 'COMPLETE') {
    console.log('Workout completed, waiting for workout');
    setTimeout(waitForWorkout, TIME_TO_WAIT_FOR_WORKOUT);
    return;
  }

  const workoutMetrics = await peloton.getWorkoutMetricsById(workoutId);
  const lastTimeInPedaling = Math.round(Date.now() / 1000) - parseInt(workout.start_time, 10);

  const { target_metrics } = workoutMetrics.target_metrics_performance_data;

  if (Array.isArray(target_metrics)) {
    let lastMetricSegment = target_metrics.find(metricsSegment => {
      return lastTimeInPedaling >= metricsSegment.offsets.start && lastTimeInPedaling < metricsSegment.offsets.end;
    });

    if (lastMetricSegment) {
      let difficulty = 0;
      let speed = 0;
      lastMetricSegment.metrics.forEach(metric => {
        // we'll base value on the average of the lower and upper bounds
        const value = Math.round((metric.lower + metric.upper) / 2);
        switch (metric.name) {
          // peloton bike metrics. these values are natively supported by the exercise lights platform
          case 'cadence':
            speed = value;
            break;
          case 'resistance':
            difficulty = value;
            break;
          case 'speed':
            speed = Math.round(CADENCE_MAX * (value / SPEED_MAX));
            break;
          case 'incline':
            difficulty = Math.round(RESISTANCE_MAX * (value / INCLINE_MAX));
            break;
        }
      });

      console.log('Speed/difficulty', speed, difficulty);

      await fetch(`http://${exerciseLightsIp}/bicycle/${speed}/${difficulty}`);
    }
  }

  setTimeout(() => checkInProgressWorkout(workoutId), TIME_TO_WAIT_FOR_METRICS);
}

async function getTopWorkout() {
  const workouts = await peloton.getWorkouts(1);
  return workouts.data[0];
}

async function waitForWorkout() {
  const topWorkout = await getTopWorkout();
  if (topWorkout.status === 'IN_PROGRESS') {
    console.log('Workout in progress, monitoring');
    checkInProgressWorkout(topWorkout.id);
  } else {
    console.log('No workout in progress, waiting...');
    setTimeout(waitForWorkout, TIME_TO_WAIT_FOR_WORKOUT);
  }
}

start();
