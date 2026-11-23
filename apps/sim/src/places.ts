/** Teleport targets. Bearing in degrees clockwise from north. */
export interface Place {
  name: string;
  lon: number;
  lat: number;
  bearing: number;
  /** A runway: the plane starts on the ground there. */
  runway?: boolean;
}

export const PLACES: Place[] = [
  { name: 'Trocadéro → Tour Eiffel', lon: 2.2905, lat: 48.8618, bearing: 140 },
  { name: 'Champs-Élysées', lon: 2.3005, lat: 48.8719, bearing: 118 },
  { name: 'Louvre · Rue de Rivoli', lon: 2.3372, lat: 48.8622, bearing: 115 },
  { name: 'Notre-Dame · Île de la Cité', lon: 2.3445, lat: 48.8545, bearing: 110 },
  { name: 'Montmartre', lon: 2.3405, lat: 48.8838, bearing: 10 },
  { name: 'La Défense', lon: 2.2345, lat: 48.8925, bearing: 110 },
  { name: 'Bois de Vincennes', lon: 2.4335, lat: 48.8323, bearing: 90 },
  { name: 'Versailles', lon: 2.1315, lat: 48.8016, bearing: 295 },
  { name: 'Orly runway', lon: 2.3445, lat: 48.7296, bearing: 64, runway: true },
  { name: 'CDG runway', lon: 2.5156, lat: 49.0128, bearing: 85, runway: true },
];
