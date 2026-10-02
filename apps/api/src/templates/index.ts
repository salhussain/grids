import type { TemplateInstaller } from '../services/projects.js';
import { flightTracker } from './flight-tracker.js';
import { healthSurveillance } from './health-surveillance.js';
import { hrWorkforce } from './hr-workforce.js';

/** Project templates (spec §16 extensibility: configuration, not code forks). */
export const installTemplate: TemplateInstaller = async (tx, c) => {
  switch (c.template) {
    case 'flight-tracker':
      return flightTracker(tx, c);
    case 'health-surveillance':
      return healthSurveillance(tx, c);
    case 'hr-workforce':
      return hrWorkforce(tx, c);
  }
};
